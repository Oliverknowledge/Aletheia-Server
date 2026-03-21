import dotenv from "dotenv";

dotenv.config();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function parsePollIntervalMs(): number {
  const raw = process.env.POLL_INTERVAL_MS ?? "1000";
  const parsed = Number.parseInt(raw, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`POLL_INTERVAL_MS must be a positive integer, received: ${raw}`);
  }

  return parsed;
}

export const config = {
  botName: "Aletheia",
  luffaBotUid: requireEnv("LUFFA_BOT_UID"),
  luffaBotSecret: requireEnv("LUFFA_BOT_SECRET"),
  pollIntervalMs: parsePollIntervalMs(),
  luffaApiBaseUrl: process.env.LUFFA_API_BASE_URL ?? "https://api.luffa.chat",
  luffaPollPath: process.env.LUFFA_POLL_PATH ?? "/v1/bot/messages/poll",
  luffaSendPath: process.env.LUFFA_SEND_PATH ?? "/v1/bot/messages/send"
};
