import { z } from "zod";

export const ANIMAL_IDS = ["pig", "cat", "bull", "rabbit", "dog"] as const;

export const AnimalIdSchema = z.enum(ANIMAL_IDS);

export const AiRoundCandidateSchema = z.object({
  id: AnimalIdSchema,
  statement: z.string(),
  isImposter: z.boolean()
});

export const AiGeneratedRoundSchema = z
  .object({
    topic: z.string(),
    difficulty: z.number(),
    imposterCandidateId: AnimalIdSchema,
    candidates: z.array(AiRoundCandidateSchema).length(5),
    explanation: z.string()
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

    for (const animalId of ANIMAL_IDS) {
      if (!uniqueIds.has(animalId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `missing candidate id: ${animalId}`,
          path: ["candidates"]
        });
      }
    }

    const imposters = round.candidates.filter((candidate) => candidate.isImposter);

    if (imposters.length !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "exactly 1 candidate must have isImposter=true",
        path: ["candidates"]
      });
      return;
    }

    const markedImposterId = imposters[0].id;

    if (round.imposterCandidateId !== markedImposterId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "imposterCandidateId must match the candidate marked as imposter",
        path: ["imposterCandidateId"]
      });
    }
  });

export type AiGeneratedRound = z.infer<typeof AiGeneratedRoundSchema>;

export function parseAiGeneratedRound(input: unknown): AiGeneratedRound {
  return AiGeneratedRoundSchema.parse(input);
}

export function safeParseAiGeneratedRound(input: unknown) {
  return AiGeneratedRoundSchema.safeParse(input);
}
