export const VALID_ANIMALS = ["pig", "cat", "bull", "rabbit", "dog"] as const;

export type AnimalGuess = (typeof VALID_ANIMALS)[number];
export type BotCommand = "help" | "restart" | "quit" | "status";

export type ParsedMessage =
  | { type: "topic"; topic: string }
  | { type: "guess"; guess: AnimalGuess }
  | { type: "command"; command: BotCommand }
  | { type: "invalid" };

const COMMANDS = new Set<BotCommand>(["help", "restart", "quit", "status"]);
const ANIMALS = new Set<AnimalGuess>(VALID_ANIMALS);

function normalizeInput(text: string): string {
  return text.trim().toLowerCase();
}

function stripLeadingSlash(value: string): string {
  return value.startsWith("/") ? value.slice(1) : value;
}

export function parseMessage(text: string, hasActiveSession: boolean): ParsedMessage {
  const normalized = normalizeInput(text);

  if (!normalized) {
    return { type: "invalid" };
  }

  const commandCandidate = stripLeadingSlash(normalized);
  if (COMMANDS.has(commandCandidate as BotCommand)) {
    return {
      type: "command",
      command: commandCandidate as BotCommand
    };
  }

  if (!hasActiveSession) {
    return {
      type: "topic",
      topic: text.trim()
    };
  }

  if (ANIMALS.has(normalized as AnimalGuess)) {
    return {
      type: "guess",
      guess: normalized as AnimalGuess
    };
  }

  return { type: "invalid" };
}
