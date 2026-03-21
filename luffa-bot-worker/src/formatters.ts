import {
  CorrectAnswerResponse,
  RoundView,
  RunCreatedResponse,
  WrongAnswerResponse
} from "./gameService";

function formatRound(round: RoundView): string {
  const candidateLines = round.candidates
    .map((candidate, index) => {
      const slot = index + 1;
      return `${slot}. ${candidate.animalName} (${candidate.id}) - ${candidate.statement}`;
    })
    .join("\n");

  return `Round ${round.roundId} (difficulty ${round.difficulty})\n${candidateLines}`;
}

export function formatStartMessage(run: RunCreatedResponse): string {
  return [
    `Aletheia online. Topic: ${run.topic}`,
    `Score: ${run.score} | Round: ${run.roundNumber}`,
    formatRound(run.round),
    "Reply with /pick <candidateId> (example: /pick rabbit)."
  ].join("\n\n");
}

export function formatCorrectMessage(result: CorrectAnswerResponse): string {
  return [
    "Correct. You found the imposter.",
    `Score: ${result.score} | Round: ${result.roundNumber}`,
    formatRound(result.round),
    "Reply with /pick <candidateId> for your next guess."
  ].join("\n\n");
}

export function formatWrongMessage(result: WrongAnswerResponse): string {
  return [
    "Wrong guess. Run over.",
    `Final score: ${result.score}`,
    `Correct imposter: ${result.reveal.correctImposterCandidateId}`,
    `Why: ${result.reveal.explanation}`,
    "Start a new run with /start planets"
  ].join("\n\n");
}

export function formatNoActiveRunMessage(): string {
  return "No active run. Start one with /start planets";
}

export function formatHelpMessage(): string {
  return [
    "Aletheia commands:",
    "/start <topic>  - start a new run",
    "/pick <id>      - submit your answer",
    "/help           - show help",
    "Example: /start planets"
  ].join("\n");
}
