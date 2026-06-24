export interface GameStatusSnapshot {
  gameActive: boolean;
  currentTopic: string;
  currentRoundNumber: number;
  currentScore: number;
}

export function formatHelpMessage(): string {
  return [
    "How to play:",
    "- Send a topic to start a round.",
    "- Reply with pig, cat, bull, rabbit, or dog to guess the imposter.",
    "- /status shows the current game state.",
    "- /help shows this help message.",
    "- /restart or /quit ends the current game."
  ].join("\n");
}

export function formatStatusMessage(snapshot: GameStatusSnapshot): string {
  if (!snapshot.gameActive) {
    return [
      "No active game.",
      "Send a topic to start a round (for example: planets)."
    ].join("\n");
  }

  return [
    "Active game",
    `Topic: ${snapshot.currentTopic || "unknown"}`,
    `Round: ${snapshot.currentRoundNumber}`,
    `Score: ${snapshot.currentScore}`
  ].join("\n");
}
