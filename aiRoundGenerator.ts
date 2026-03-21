import { z } from "zod";

const ANIMAL_IDS = ["pig", "cat", "bull", "rabbit", "dog"] as const;

const AnimalIdSchema = z.enum(ANIMAL_IDS);

const AiRoundCandidateSchema = z.object({
  id: AnimalIdSchema,
  statement: z.string().min(1),
  isImposter: z.boolean()
});

export const AiRoundSchema = z
  .object({
    topic: z.string().min(1),
    difficulty: z.number(),
    imposterCandidateId: AnimalIdSchema,
    candidates: z.array(AiRoundCandidateSchema).length(5),
    explanation: z.string().min(1)
  })
  .superRefine((round, ctx) => {
    const ids = round.candidates.map((candidate) => candidate.id);
    const uniqueIds = new Set(ids);

    if (uniqueIds.size !== ANIMAL_IDS.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "candidates must contain each fixed animal id exactly once",
        path: ["candidates"]
      });
    }

    const imposterCount = round.candidates.filter((candidate) => candidate.isImposter).length;
    if (imposterCount !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "exactly 1 candidate must have isImposter=true",
        path: ["candidates"]
      });
      return;
    }

    const imposter = round.candidates.find((candidate) => candidate.isImposter);
    if (imposter && imposter.id !== round.imposterCandidateId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "imposterCandidateId must match the candidate marked as imposter",
        path: ["imposterCandidateId"]
      });
    }
  });

export type AiRound = z.infer<typeof AiRoundSchema>;

export interface RoundGenerationHistory {
  usedFalseConcepts?: string[];
  usedStatements?: string[];
  priorRoundSignatures?: string[];
}

export interface RoundAnalysis {
  falseConceptKey: string;
  statementKeys: string[];
  roundSignature: string;
  imposterStatement: string;
  imposterStatementKey: string;
}

type AiGenerationFailureReason =
  | "network_error"
  | "invalid_json"
  | "invalid_schema"
  | "llm_response_error";

class AiRoundGenerationError extends Error {
  readonly reason: AiGenerationFailureReason;

  constructor(reason: AiGenerationFailureReason, message: string) {
    super(message);
    this.reason = reason;
    this.name = "AiRoundGenerationError";
  }
}

const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";
const MAX_AI_ATTEMPTS = 4;
const MAX_FALLBACK_ATTEMPTS = 6;
const MAX_HISTORY_ITEMS = 40;

const RESPONSE_SCHEMA_JSON = {
  type: "object",
  additionalProperties: false,
  required: ["topic", "difficulty", "imposterCandidateId", "candidates", "explanation"],
  properties: {
    topic: { type: "string" },
    difficulty: { type: "number" },
    imposterCandidateId: {
      type: "string",
      enum: [...ANIMAL_IDS]
    },
    candidates: {
      type: "array",
      minItems: 5,
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "statement", "isImposter"],
        properties: {
          id: {
            type: "string",
            enum: [...ANIMAL_IDS]
          },
          statement: { type: "string" },
          isImposter: { type: "boolean" }
        }
      }
    },
    explanation: { type: "string" }
  }
} as const;

type FalseConceptTemplate = {
  key: string;
  basic: string;
  medium: string;
  hard: string;
};

const GENERIC_TRUE_POOL = {
  basic: [
    "Reliable examples help people learn {topic} correctly.",
    "Checking multiple trusted sources improves understanding of {topic}.",
    "Practicing step by step helps build skill in {topic}.",
    "Clear definitions make {topic} easier to understand.",
    "Reviewing mistakes can improve long-term learning in {topic}.",
    "Comparing similar cases can reveal patterns in {topic}.",
    "Breaking {topic} into smaller parts improves accuracy.",
    "Good notes can help retain key ideas in {topic}."
  ],
  medium: [
    "In {topic}, edge cases often reveal weak assumptions.",
    "Different methods can agree on the same result in {topic}.",
    "Precise conditions often matter when applying rules in {topic}.",
    "A convincing-looking answer in {topic} can still be wrong without verification.",
    "Counterexamples are useful for testing claims about {topic}.",
    "A solid explanation in {topic} should connect steps, not just final results.",
    "Equivalent forms in {topic} can look different but mean the same thing.",
    "Context can change which tool is best in {topic}."
  ],
  hard: [
    "In {topic}, local reasoning can fail without checking global constraints.",
    "A method in {topic} can be valid in one region and invalid in another.",
    "Subtle assumptions in {topic} often break when domain limits are ignored.",
    "Two statements in {topic} can both be true while one is less generally applicable.",
    "Small notation differences in {topic} can encode important restrictions.",
    "In {topic}, a valid transformation can still hide information loss if conditions are skipped.",
    "Advanced {topic} problems often require checking invariants, not only calculations.",
    "The strongest claims in {topic} usually require the strongest hypotheses."
  ]
};

const GENERIC_FALSE_CONCEPTS: FalseConceptTemplate[] = [
  {
    key: "absolute_rule_no_exception",
    basic: "Every rule in {topic} has no exceptions.",
    medium: "If a method worked once in {topic}, it is always valid in every case.",
    hard: "In {topic}, edge conditions never change conclusions from the common case."
  },
  {
    key: "reverse_implication",
    basic: "If B follows from A in {topic}, then A must always follow from B.",
    medium: "In {topic}, any sufficient condition is automatically necessary.",
    hard: "In {topic}, proving one directional implication proves equivalence."
  },
  {
    key: "ignore_conditions",
    basic: "Conditions can be ignored when applying rules in {topic}.",
    medium: "Domain and assumptions almost never matter in {topic}.",
    hard: "In {topic}, hypotheses are stylistic and do not affect validity."
  },
  {
    key: "proof_by_example",
    basic: "One example is enough to prove a general claim in {topic}.",
    medium: "In {topic}, testing a few easy cases guarantees universal truth.",
    hard: "A finite sample in {topic} can establish necessity without structural proof."
  },
  {
    key: "notation_means_identity",
    basic: "If two expressions in {topic} look similar, they always mean the same thing.",
    medium: "In {topic}, notation differences never imply different constraints.",
    hard: "Symbolically close forms in {topic} are interchangeable without checking context."
  },
  {
    key: "verification_not_needed",
    basic: "A plausible answer in {topic} does not need to be checked.",
    medium: "In {topic}, internal consistency is enough even without external validation.",
    hard: "For {topic}, local correctness guarantees global correctness."
  }
];

const INTEGRATION_TRUE_POOL = {
  basic: [
    "The integral of sin(x) is -cos(x) + C.",
    "The integral of 1/x is ln|x| + C for x != 0.",
    "The integral of e^x is e^x + C.",
    "The integral of x^n is x^(n+1)/(n+1) + C for n != -1.",
    "A definite integral gives signed area over an interval.",
    "Substitution is based on reversing the chain rule.",
    "Integration by parts comes from the product rule.",
    "An antiderivative is not unique because of +C."
  ],
  medium: [
    "If f is continuous on [a,b], then integral_a^b f(x) dx exists.",
    "The derivative of an antiderivative returns the original integrand where differentiable.",
    "u-substitution requires replacing both the expression and dx consistently.",
    "Definite integrals do not include +C.",
    "The integral of 1/x^2 is -1/x + C.",
    "If a function is odd, integral_-a^a f(x) dx is 0.",
    "Integrating term-by-term is valid for finite sums.",
    "A zero integral over an interval does not necessarily mean the function is zero everywhere."
  ],
  hard: [
    "Not every elementary-looking function has an elementary antiderivative.",
    "A substitution can fail if it is not one-to-one over the integration interval in definite form.",
    "Piecewise behavior can require splitting an integral into sub-intervals.",
    "Improper integrals are defined through limits, not ordinary antiderivatives alone.",
    "Absolute convergence implies convergence, but the converse can fail for some integrals.",
    "Numeric quadrature can approximate integrals when symbolic antiderivatives are unavailable.",
    "A change of variables in multiple dimensions introduces a Jacobian factor.",
    "Continuity is sufficient but not necessary for Riemann integrability."
  ]
};

const INTEGRATION_FALSE_CONCEPTS: FalseConceptTemplate[] = [
  {
    key: "sin_sign_error",
    basic: "The integral of sin(x) is cos(x) + C.",
    medium: "Integrating sin(x) gives cos(x) because derivative and antiderivative signs match.",
    hard: "For sinusoidal functions, antiderivatives preserve phase and sign exactly."
  },
  {
    key: "one_over_x_linear_error",
    basic: "The integral of 1/x is x + C.",
    medium: "Since derivative of x is 1, the integral of 1/x should still be x + C.",
    hard: "Logarithmic antiderivatives are optional for 1/x; linear forms are equivalent."
  },
  {
    key: "exp_x_squared_elementary",
    basic: "The integral of e^(x^2) has a simple elementary antiderivative.",
    medium: "A quick substitution always turns integral e^(x^2) dx into elementary form.",
    hard: "e^(x^2) is elementary-integrable because exponentials remain closed under substitution."
  },
  {
    key: "one_over_x2_log_error",
    basic: "The integral of 1/x^2 is ln|x| + C.",
    medium: "Any reciprocal power 1/x^n integrates to a logarithm.",
    hard: "Reciprocal-square antiderivatives are logarithmic by the same rule as 1/x."
  },
  {
    key: "definite_integral_plus_c",
    basic: "A definite integral result should include +C.",
    medium: "All integrals, including definite ones, need a constant of integration.",
    hard: "The accumulation constant remains free even after applying bounds."
  },
  {
    key: "parts_formula_swap",
    basic: "Integration by parts uses integral u dv = uv + integral v du.",
    medium: "In integration by parts, the correction term is added, not subtracted.",
    hard: "The sign in integration by parts is convention-only and does not affect correctness."
  },
  {
    key: "linearity_product",
    basic: "The integral of f(x)g(x) is always the product of their integrals.",
    medium: "Linearity of integration extends directly to multiplication of functions.",
    hard: "Bilinearity implies integral fg behaves like pointwise multiplication under integration."
  },
  {
    key: "u_sub_ignore_dx",
    basic: "In substitution, only the inside function is replaced; dx can stay unchanged.",
    medium: "A u-substitution can ignore differential scaling without changing the value.",
    hard: "The Jacobian factor in one-variable substitution is optional if bounds are adjusted."
  }
];

function buildSystemPrompt(): string {
  return [
    "You generate educational imposter-game rounds.",
    "Return ONLY valid JSON matching the provided schema.",
    "No markdown, no prose, no extra keys.",
    "Candidates must be exactly pig, cat, bull, rabbit, dog with exactly one imposter."
  ].join(" ");
}

function uniqueRecent(values: string[], limit: number): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (let i = values.length - 1; i >= 0; i -= 1) {
    const value = values[i].trim();
    if (!value || seen.has(value)) {
      continue;
    }

    seen.add(value);
    result.unshift(value);

    if (result.length >= limit) {
      break;
    }
  }

  return result;
}

function canonicalizeStatement(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9+\-*/^=| ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeHistory(history?: RoundGenerationHistory): Required<RoundGenerationHistory> {
  const usedFalseConcepts = uniqueRecent(
    (history?.usedFalseConcepts ?? [])
      .map((value) => value.toLowerCase().trim())
      .filter(Boolean),
    MAX_HISTORY_ITEMS
  );

  const usedStatements = uniqueRecent(
    (history?.usedStatements ?? []).map((value) => canonicalizeStatement(value)).filter(Boolean),
    MAX_HISTORY_ITEMS
  );

  const priorRoundSignatures = uniqueRecent(
    (history?.priorRoundSignatures ?? []).map((value) => value.trim()).filter(Boolean),
    MAX_HISTORY_ITEMS
  );

  return {
    usedFalseConcepts,
    usedStatements,
    priorRoundSignatures
  };
}

function buildDifficultyGuidance(difficulty: number): string {
  if (difficulty <= 1) {
    return "Use obvious beginner-level truths and one obvious misconception.";
  }

  if (difficulty <= 3) {
    return "Use intermediate facts and a plausible misconception that could fool a beginner.";
  }

  return "Use advanced, subtle truths and a subtle but still clearly false misconception.";
}

function buildHistoryPrompt(history: Required<RoundGenerationHistory>): string[] {
  const sections: string[] = [];

  if (history.usedFalseConcepts.length > 0) {
    sections.push(`Avoid these previously used false concepts: ${history.usedFalseConcepts.join("; ")}.`);
  }

  if (history.usedStatements.length > 0) {
    sections.push(`Do not reuse these prior statements (or near paraphrases): ${history.usedStatements.join("; ")}.`);
  }

  return sections;
}

function buildUserPrompt(
  topic: string,
  difficulty: number,
  history: Required<RoundGenerationHistory>
): string {
  const base = [
    `Create one round for topic: ${topic}.`,
    `Difficulty: ${difficulty}.`,
    buildDifficultyGuidance(difficulty),
    "Use exactly these candidate ids: pig, cat, bull, rabbit, dog.",
    "Exactly one candidate must be the imposter (false statement).",
    "The other four statements must be true.",
    "The false statement must be plausible, not ridiculous.",
    "Set imposterCandidateId to the imposter candidate id.",
    "Include isImposter per candidate.",
    "Include a short explanation of why the imposter statement is wrong.",
    "Ensure the round is materially different from prior rounds in wording and concept."
  ];

  return [...base, ...buildHistoryPrompt(history)].join(" ");
}

function getApiKey(): string {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    throw new Error("Missing OPENAI_API_KEY environment variable");
  }

  return key;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

async function callLlmApi(prompt: string): Promise<unknown> {
  const apiKey = getApiKey();

  let response: Response;
  try {
    response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [
          { role: "system", content: buildSystemPrompt() },
          { role: "user", content: prompt }
        ],
        temperature: 0.6,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "ai_round",
            strict: true,
            schema: RESPONSE_SCHEMA_JSON
          }
        }
      })
    });
  } catch (error) {
    throw new AiRoundGenerationError(
      "network_error",
      `LLM API network failure: ${toErrorMessage(error)}`
    );
  }

  const rawBody = await response.text();

  if (!response.ok) {
    throw new AiRoundGenerationError(
      "llm_response_error",
      `LLM API request failed (${response.status}): ${rawBody}`
    );
  }

  try {
    return JSON.parse(rawBody);
  } catch (error) {
    throw new AiRoundGenerationError(
      "invalid_json",
      `LLM API returned non-JSON response body: ${toErrorMessage(error)}`
    );
  }
}

function extractAssistantContent(rawResponse: unknown): string {
  const content = (rawResponse as any)?.choices?.[0]?.message?.content;

  if (typeof content !== "string" || !content.trim()) {
    throw new AiRoundGenerationError(
      "invalid_json",
      "LLM API response missing choices[0].message.content"
    );
  }

  return content;
}

function parseRoundJson(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch (error) {
    throw new AiRoundGenerationError(
      "invalid_json",
      `LLM content is not valid JSON: ${toErrorMessage(error)}`
    );
  }
}

function validateRoundShape(value: unknown): AiRound {
  const parsed = AiRoundSchema.safeParse(value);

  if (!parsed.success) {
    throw new AiRoundGenerationError(
      "invalid_schema",
      `AI round validation failed: ${parsed.error.message}`
    );
  }

  return parsed.data;
}

function shouldFallback(error: unknown): boolean {
  return (
    error instanceof AiRoundGenerationError &&
    (error.reason === "network_error" ||
      error.reason === "invalid_json" ||
      error.reason === "invalid_schema")
  );
}

function summarizeCandidates(round: AiRound): string {
  return round.candidates
    .map((candidate) => `${candidate.id}: ${candidate.statement}`)
    .join(" | ");
}

function deriveFalseConceptKey(statementKey: string): string {
  const value = statementKey.toLowerCase();

  if (
    (value.includes("sin") && value.includes("cos") && value.includes("integral")) ||
    value.includes("integrating sin")
  ) {
    return "sin_sign_error";
  }

  if (value.includes("1/x") && value.includes("x + c")) {
    return "one_over_x_linear_error";
  }

  if (value.includes("1/x^2") && value.includes("ln")) {
    return "one_over_x2_log_error";
  }

  if (value.includes("e^(x^2)") && value.includes("elementary")) {
    return "exp_x_squared_elementary";
  }

  if (value.includes("integration by parts") && value.includes("added")) {
    return "parts_formula_swap";
  }

  if (value.includes("product of their integrals")) {
    return "linearity_product";
  }

  if (value.includes("dx can stay unchanged") || value.includes("ignore differential scaling")) {
    return "u_sub_ignore_dx";
  }

  if (value.includes("every rule") && value.includes("no exceptions")) {
    return "absolute_rule_no_exception";
  }

  if (value.includes("worked once") && value.includes("always valid")) {
    return "absolute_rule_no_exception";
  }

  if (value.includes("if b follows from a")) {
    return "reverse_implication";
  }

  if (value.includes("sufficient condition") && value.includes("necessary")) {
    return "reverse_implication";
  }

  if (value.includes("conditions can be ignored") || value.includes("domain and assumptions")) {
    return "ignore_conditions";
  }

  if (value.includes("one example is enough") || value.includes("few easy cases")) {
    return "proof_by_example";
  }

  if (value.includes("look similar") && value.includes("always mean the same")) {
    return "notation_means_identity";
  }

  if (value.includes("plausible answer") && value.includes("does not need to be checked")) {
    return "verification_not_needed";
  }

  if (value.includes("definite integral") && value.includes("+c")) {
    return "definite_integral_plus_c";
  }

  const tokens = value
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean)
    .slice(0, 8);

  return tokens.length > 0 ? tokens.join("_") : "unknown_false_concept";
}

export function analyzeRound(round: AiRound): RoundAnalysis {
  const byId = new Map(round.candidates.map((candidate) => [candidate.id, candidate.statement]));
  const statementKeys = ANIMAL_IDS.map((id) => canonicalizeStatement(byId.get(id) ?? ""));
  const roundSignature = statementKeys.join("||");

  const imposterStatement =
    round.candidates.find((candidate) => candidate.id === round.imposterCandidateId)?.statement ?? "";
  const imposterStatementKey = canonicalizeStatement(imposterStatement);

  return {
    falseConceptKey: deriveFalseConceptKey(imposterStatementKey),
    statementKeys,
    roundSignature,
    imposterStatement,
    imposterStatementKey
  };
}

type RepetitionCheck = {
  repeated: boolean;
  reasons: string[];
};

function countNearStatementMatches(statementKey: string, usedStatements: string[]): number {
  const tokens = new Set(statementKey.split(" ").filter(Boolean));
  if (tokens.size === 0) {
    return 0;
  }

  let nearMatches = 0;

  for (const used of usedStatements) {
    if (!used) {
      continue;
    }

    if (used === statementKey) {
      nearMatches += 1;
      continue;
    }

    const usedTokens = new Set(used.split(" ").filter(Boolean));
    if (usedTokens.size === 0) {
      continue;
    }

    let intersection = 0;
    for (const token of tokens) {
      if (usedTokens.has(token)) {
        intersection += 1;
      }
    }

    const union = tokens.size + usedTokens.size - intersection;
    const jaccard = union > 0 ? intersection / union : 0;

    if (jaccard >= 0.86) {
      nearMatches += 1;
    }
  }

  return nearMatches;
}

function checkRepetition(
  analysis: RoundAnalysis,
  history: Required<RoundGenerationHistory>
): RepetitionCheck {
  const reasons: string[] = [];
  const usedFalseConcepts = new Set(history.usedFalseConcepts);

  if (analysis.falseConceptKey && usedFalseConcepts.has(analysis.falseConceptKey)) {
    reasons.push(`false concept reused: ${analysis.falseConceptKey}`);
  }

  const exactReuse = analysis.statementKeys.filter((key) => history.usedStatements.includes(key)).length;
  if (exactReuse > 0) {
    reasons.push(`exact statement overlap: ${exactReuse}`);
  }

  let nearReuse = 0;
  for (const statementKey of analysis.statementKeys) {
    nearReuse += countNearStatementMatches(statementKey, history.usedStatements);
  }
  if (nearReuse > 1) {
    reasons.push(`near statement overlap: ${nearReuse}`);
  }

  if (history.priorRoundSignatures.includes(analysis.roundSignature)) {
    reasons.push("round signature duplicated");
  }

  for (const priorSignature of history.priorRoundSignatures) {
    const priorKeys = priorSignature.split("||").filter(Boolean);
    let overlap = 0;
    for (const key of analysis.statementKeys) {
      if (priorKeys.includes(key)) {
        overlap += 1;
      }
    }

    if (overlap >= 3) {
      reasons.push(`heavy overlap with prior round: ${overlap}/5`);
      break;
    }
  }

  return {
    repeated: reasons.length > 0,
    reasons
  };
}

function topicLooksLikeIntegration(topic: string): boolean {
  return /integrat|integral|antideriv|calculus|u-sub|substitution|parts/i.test(topic);
}

function fillTopic(template: string, topic: string): string {
  return template.replaceAll("{topic}", topic);
}

function poolForDifficulty(difficulty: number): "basic" | "medium" | "hard" {
  if (difficulty <= 1) {
    return "basic";
  }

  if (difficulty <= 3) {
    return "medium";
  }

  return "hard";
}

function shuffle<T>(input: T[]): T[] {
  const arr = [...input];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = arr[i];
    arr[i] = arr[j];
    arr[j] = temp;
  }

  return arr;
}

function chooseOne<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function selectUniqueStatements(pool: string[], used: Set<string>, count: number): string[] {
  const fresh = shuffle(pool).filter((statement) => !used.has(canonicalizeStatement(statement)));
  if (fresh.length >= count) {
    return fresh.slice(0, count);
  }

  const topUp = shuffle(pool.filter((statement) => !fresh.includes(statement)));
  return [...fresh, ...topUp].slice(0, count);
}

function falseTemplateMatchesUsedConcept(
  template: FalseConceptTemplate,
  topic: string,
  usedFalseConcepts: Set<string>
): boolean {
  const keys = [
    deriveFalseConceptKey(canonicalizeStatement(fillTopic(template.basic, topic))),
    deriveFalseConceptKey(canonicalizeStatement(fillTopic(template.medium, topic))),
    deriveFalseConceptKey(canonicalizeStatement(fillTopic(template.hard, topic))),
    template.key
  ];

  return keys.some((key) => usedFalseConcepts.has(key));
}

function buildFallbackRoundCandidate(
  topic: string,
  difficulty: number,
  history: Required<RoundGenerationHistory>
): AiRound {
  const tier = poolForDifficulty(difficulty);
  const integrationMode = topicLooksLikeIntegration(topic);

  const truePoolTemplate = integrationMode ? INTEGRATION_TRUE_POOL : GENERIC_TRUE_POOL;
  const falseTemplates = integrationMode ? INTEGRATION_FALSE_CONCEPTS : GENERIC_FALSE_CONCEPTS;

  const truePool = truePoolTemplate[tier].map((template) => fillTopic(template, topic));
  const usedStatementSet = new Set(history.usedStatements);
  const usedFalseConceptSet = new Set(history.usedFalseConcepts);

  const availableFalseTemplates = falseTemplates.filter(
    (template) => !falseTemplateMatchesUsedConcept(template, topic, usedFalseConceptSet)
  );
  const falseTemplate = chooseOne(availableFalseTemplates.length > 0 ? availableFalseTemplates : falseTemplates);
  const falseStatement = fillTopic(falseTemplate[tier], topic);

  const trueStatements = selectUniqueStatements(truePool, usedStatementSet, 4);
  const imposterIndex = Math.floor(Math.random() * ANIMAL_IDS.length);

  let truthIndex = 0;
  const candidates = ANIMAL_IDS.map((id, index) => {
    const isImposter = index === imposterIndex;
    const statement = isImposter ? falseStatement : trueStatements[truthIndex++];

    return {
      id,
      statement,
      isImposter
    };
  });

  return {
    topic,
    difficulty,
    imposterCandidateId: ANIMAL_IDS[imposterIndex],
    candidates,
    explanation: `${ANIMAL_IDS[imposterIndex]} is incorrect because the claim conflicts with established facts about ${topic}.`
  };
}

function logRoundDetails(
  source: "AI" | "fallback mock",
  round: AiRound,
  analysis: RoundAnalysis,
  regenerated: boolean,
  history: Required<RoundGenerationHistory>
): void {
  console.info(`[ai-round] source=${source}`);
  console.info(`[ai-round] selected imposterCandidateId=${round.imposterCandidateId}`);
  console.info(`[ai-round] false concept key=${analysis.falseConceptKey}`);
  console.info(`[ai-round] regenerated due to repetition=${regenerated}`);
  console.info(`[ai-round] usedFalseConcepts=${JSON.stringify(history.usedFalseConcepts)}`);
  console.info(`[ai-round] candidate list=${summarizeCandidates(round)}`);
}

function generateFallbackRound(
  topic: string,
  difficulty: number,
  history: Required<RoundGenerationHistory>
): AiRound {
  let regenerated = false;

  for (let attempt = 1; attempt <= MAX_FALLBACK_ATTEMPTS; attempt += 1) {
    const candidate = buildFallbackRoundCandidate(topic, difficulty, history);
    const validated = validateRoundShape(candidate);
    const analysis = analyzeRound(validated);
    const repetition = checkRepetition(analysis, history);

    if (repetition.repeated && attempt < MAX_FALLBACK_ATTEMPTS) {
      regenerated = true;
      console.warn(
        `[ai-round] regenerated due to repetition source=fallback mock attempt=${attempt} reasons=${repetition.reasons.join(
          " | "
        )}`
      );
      continue;
    }

    if (repetition.repeated) {
      regenerated = true;
      console.warn(
        `[ai-round] fallback reached max attempts; accepting repeated candidate reasons=${repetition.reasons.join(
          " | "
        )}`
      );
    }

    logRoundDetails("fallback mock", validated, analysis, regenerated || repetition.repeated, history);
    return validated;
  }

  throw new Error("Fallback round generation failed");
}

export async function generateAiRound(
  topic: string,
  difficulty: number,
  historyInput: RoundGenerationHistory = {}
): Promise<AiRound> {
  const safeTopic = topic.trim();
  if (!safeTopic) {
    throw new Error("generateAiRound requires a non-empty topic");
  }

  if (!Number.isFinite(difficulty)) {
    throw new Error("generateAiRound requires a finite difficulty number");
  }

  const safeDifficulty = Math.max(1, Math.round(difficulty));
  const history = normalizeHistory(historyInput);

  try {
    let regenerated = false;

    for (let attempt = 1; attempt <= MAX_AI_ATTEMPTS; attempt += 1) {
      const prompt = buildUserPrompt(safeTopic, safeDifficulty, history);
      const rawResponse = await callLlmApi(prompt);
      const content = extractAssistantContent(rawResponse);
      const parsedJson = parseRoundJson(content);
      const round = validateRoundShape(parsedJson);
      const analysis = analyzeRound(round);
      const repetition = checkRepetition(analysis, history);

      if (repetition.repeated && attempt < MAX_AI_ATTEMPTS) {
        regenerated = true;
        console.warn(
          `[ai-round] regenerated due to repetition source=AI attempt=${attempt} reasons=${repetition.reasons.join(
            " | "
          )}`
        );
        continue;
      }

      if (repetition.repeated) {
        regenerated = true;
        console.warn(
          `[ai-round] AI reached max attempts; accepting repeated candidate reasons=${repetition.reasons.join(
            " | "
          )}`
        );
      }

      logRoundDetails("AI", round, analysis, regenerated || repetition.repeated, history);
      return round;
    }

    throw new Error("AI round generation exhausted attempts");
  } catch (error) {
    if (!shouldFallback(error)) {
      throw error;
    }

    console.warn(
      `[ai-round] source=fallback mock reason=${
        error instanceof AiRoundGenerationError ? error.reason : "unknown"
      }`
    );

    return generateFallbackRound(safeTopic, safeDifficulty, history);
  }
}
