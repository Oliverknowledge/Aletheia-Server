import axios, { AxiosError, AxiosInstance } from "axios";
import { config } from "./config";

const RECEIVE_URL = "https://apibot.luffa.im/robot/receive";
const SEND_DIRECT_URL = "https://apibot.luffa.im/robot/send";
const SEND_GROUP_URL = "https://apibot.luffa.im/robot/sendGroup";

export interface LuffaReceivedMessage {
  messageId: string;
  msgId: string;
  envelopeUid: string;
  type: string;
  uid: string;
  senderUid: string;
  text: string;
  isGroup: boolean;
  timestamp: number;
  raw: unknown;
}

export interface LuffaReceiveResult {
  messages: LuffaReceivedMessage[];
  raw: unknown;
}

export interface LuffaInboundMessage {
  messageId: string;
  sessionId: string;
  senderUid: string;
  text: string;
  timestamp: number;
  isGroup: boolean;
}

export interface LuffaPollResult {
  messages: LuffaInboundMessage[];
  nextCursor?: string;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asTimestamp(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return Date.now();
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function extractTextFromMsg(msg: unknown): string {
  if (typeof msg === "string") {
    const parsed = safeJsonParse(msg);
    if (parsed && typeof parsed === "object") {
      const parsedText = asString((parsed as any).text ?? (parsed as any).content?.text).trim();
      if (parsedText) {
        return parsedText;
      }
    }

    return msg.trim();
  }

  if (msg && typeof msg === "object") {
    return asString((msg as any).text ?? (msg as any).content?.text).trim();
  }

  return "";
}

function extractRawMessages(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (!payload || typeof payload !== "object") {
    return [];
  }

  const p = payload as any;

  if (Array.isArray(p.messages)) {
    return p.messages;
  }

  if (Array.isArray(p.items)) {
    return p.items;
  }

  if (Array.isArray(p.list)) {
    return p.list;
  }

  if (Array.isArray(p.data)) {
    return p.data;
  }

  if (Array.isArray(p.data?.messages)) {
    return p.data.messages;
  }

  if (Array.isArray(p.data?.items)) {
    return p.data.items;
  }

  if (Array.isArray(p.data?.list)) {
    return p.data.list;
  }

  return [];
}

function parseMessageEntry(entry: unknown): any | null {
  if (typeof entry === "string") {
    const parsed = safeJsonParse(entry);
    if (parsed && typeof parsed === "object") {
      return parsed as any;
    }

    return null;
  }

  if (entry && typeof entry === "object") {
    return entry as any;
  }

  return null;
}

function normalizeType(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return asString(value).trim();
}

function isEnvelope(raw: unknown): raw is { message: unknown[] } {
  return Boolean(raw && typeof raw === "object" && Array.isArray((raw as any).message));
}

function logParsedMessage(parsed: {
  envelopeUid: string;
  senderUid: string;
  msgId: string;
  text: string;
  isGroup: boolean;
  type: string;
}): void {
  console.log(`[parsed] ${stringifyForLog(parsed)}`);
}

function stringifyForLog(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function normalizeReceivedMessage(raw: unknown, index: number): LuffaReceivedMessage | null {
  let rawObject: unknown = raw;

  if (typeof raw === "string") {
    rawObject = safeJsonParse(raw);
  }

  if (!rawObject || typeof rawObject !== "object") {
    return null;
  }

  const r = rawObject as any;

  const uid = asString(
    r.uid ?? r.chatUid ?? r.sessionId ?? r.dialogId ?? r.groupUid ?? r.conversationId
  ).trim();

  if (!uid) {
    return null;
  }

  const directText = asString(r.text ?? r.content?.text).trim();
  const msgText = extractTextFromMsg(r.msg ?? r.message);
  const text = directText || msgText;

  if (!text) {
    return null;
  }

  const typeValue = asString(r.type ?? r.chatType).trim();
  const isGroup =
    typeValue === "1" ||
    typeValue.toLowerCase() === "group" ||
    Boolean(r.groupUid ?? r.groupId);

  const msgId =
    asString(r.messageId ?? r.msgId ?? r.id).trim() || `msg_${Date.now()}_${index}`;
  const envelopeUid = asString(r.envelopeUid ?? r.uid ?? r.chatUid ?? r.sessionId).trim();
  const senderUid = asString(r.senderUid ?? r.fromUid ?? r.from_uid ?? r.sender?.uid).trim();
  const type = normalizeType(r.type ?? r.chatType ?? (isGroup ? "1" : "0"));

  logParsedMessage({
    envelopeUid,
    senderUid,
    msgId,
    text,
    isGroup,
    type
  });

  return {
    messageId: msgId,
    msgId,
    envelopeUid,
    type,
    uid,
    senderUid,
    text,
    isGroup,
    timestamp: asTimestamp(r.timestamp ?? r.createdAt ?? r.time),
    raw
  };
}

function normalizeEnvelopeMessages(rawEnvelope: unknown, envelopeIndex: number): LuffaReceivedMessage[] {
  if (!isEnvelope(rawEnvelope)) {
    return [];
  }

  const envelope = rawEnvelope as any;
  const envelopeUid = asString(
    envelope.uid ?? envelope.chatUid ?? envelope.sessionId ?? envelope.dialogId
  ).trim();
  const envelopeType = normalizeType(envelope.type ?? envelope.chatType);
  const envelopeIsGroup =
    envelopeType === "1" ||
    envelopeType.toLowerCase() === "group" ||
    Boolean(envelope.groupUid ?? envelope.groupId);

  const normalized: LuffaReceivedMessage[] = [];

  for (let i = 0; i < envelope.message.length; i += 1) {
    const rawEntry = envelope.message[i];

    try {
      const entry = parseMessageEntry(rawEntry);
      if (!entry) {
        continue;
      }

      const text = asString(entry.text ?? entry.content?.text).trim();
      if (!text) {
        continue;
      }

      const msgId =
        asString(entry.msgId ?? entry.messageId ?? entry.id).trim() ||
        `msg_${Date.now()}_${envelopeIndex}_${i}`;
      const senderUid = asString(
        entry.senderUid ?? entry.fromUid ?? entry.from_uid ?? entry.uid ?? envelope.uid
      ).trim();
      const entryType = normalizeType(entry.type ?? entry.chatType ?? envelopeType);
      const isGroup =
        entryType === "1" ||
        entryType.toLowerCase() === "group" ||
        envelopeIsGroup ||
        Boolean(entry.groupUid ?? entry.groupId ?? envelope.groupUid ?? envelope.groupId);
      const uid = envelopeUid || asString(entry.uid ?? entry.chatUid ?? entry.sessionId).trim();

      logParsedMessage({
        envelopeUid,
        senderUid,
        msgId,
        text,
        isGroup,
        type: entryType || (isGroup ? "1" : "0")
      });

      normalized.push({
        messageId: msgId,
        msgId,
        envelopeUid,
        type: entryType || (isGroup ? "1" : "0"),
        uid,
        senderUid,
        text,
        isGroup,
        timestamp: asTimestamp(
          entry.timestamp ??
            entry.createdAt ??
            entry.time ??
            envelope.timestamp ??
            envelope.createdAt ??
            envelope.time
        ),
        raw: {
          envelope: rawEnvelope,
          message: rawEntry
        }
      });
    } catch (error) {
      console.error("[poll] parse entry failure", error);
      console.error(`[poll] malformed entry: ${stringifyForLog(rawEntry)}`);
    }
  }

  return normalized;
}

function isFailureBody(body: unknown): boolean {
  if (!body || typeof body !== "object") {
    return false;
  }

  const b = body as any;

  if (typeof b.success === "boolean") {
    return !b.success;
  }

  if (typeof b.ok === "boolean") {
    return !b.ok;
  }

  const code = b.code ?? b.errcode;
  if (typeof code === "number") {
    return code !== 0 && code !== 200;
  }

  if (typeof code === "string") {
    const normalized = code.trim().toLowerCase();
    return normalized !== "0" && normalized !== "200" && normalized !== "ok";
  }

  return false;
}

export class LuffaApiClient {
  private readonly http: AxiosInstance;

  constructor() {
    this.http = axios.create({
      timeout: 15_000,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }

  async receiveMessages(): Promise<LuffaReceiveResult> {
    let responseBody: unknown;

    try {
      const response = await this.http.post(RECEIVE_URL, {
        secret: config.luffaBotSecret
      });

      responseBody = response.data;

      console.log(`[poll] receive status: ${response.status}`);
      console.log(`[poll] raw body: ${stringifyForLog(responseBody)}`);

      if (isFailureBody(responseBody)) {
        console.error("[LuffaApi] receiveMessages API failure", {
          status: response.status,
          body: responseBody
        });
        throw new Error("receiveMessages failed with API error response");
      }
    } catch (error) {
      this.logHttpError("receiveMessages", error);
      throw error;
    }

    try {
      const rootItems = extractRawMessages(responseBody);
      const messages: LuffaReceivedMessage[] = [];

      rootItems.forEach((rawItem, index) => {
        if (isEnvelope(rawItem)) {
          messages.push(...normalizeEnvelopeMessages(rawItem, index));
          return;
        }

        const single = normalizeReceivedMessage(rawItem, index);
        if (single) {
          messages.push(single);
        }
      });

      return {
        messages,
        raw: responseBody
      };
    } catch (error) {
      console.error("[poll] parse failure");
      console.error(error);
      console.error(`[poll] raw body: ${stringifyForLog(responseBody)}`);

      return {
        messages: [],
        raw: responseBody
      };
    }
  }

  async sendDirectMessage(uid: string, text: string): Promise<void> {
    const safeUid = uid.trim();
    const safeText = text.trim();

    if (!safeUid) {
      throw new Error("sendDirectMessage requires a non-empty uid");
    }

    if (!safeText) {
      throw new Error("sendDirectMessage requires non-empty text");
    }

    const payload = {
      secret: config.luffaBotSecret,
      uid: safeUid,
      msg: JSON.stringify({ text: safeText })
    };

    console.log(
      `[dm] send request payload: ${stringifyForLog({
        ...payload,
        secret: "***redacted***"
      })}`
    );

    console.log(`[dm] send request msg is string: ${typeof payload.msg === "string"}`);

    if (typeof payload.msg !== "string") {
      throw new Error("sendDirectMessage payload.msg must be a JSON string");
    }

    try {
      const response = await this.http.post(SEND_DIRECT_URL, payload);
      const responseBody = response.data;

      console.log(`[dm] send status: ${response.status}`);
      console.log(`[dm] send raw body: ${stringifyForLog(responseBody)}`);

      if (isFailureBody(responseBody)) {
        console.error("[LuffaApi] sendDirectMessage API failure", {
          status: response.status,
          body: responseBody
        });
        throw new Error("sendDirectMessage failed with API error response");
      }
    } catch (error) {
      this.logHttpError("sendDirectMessage", error);
      throw error;
    }
  }

  async sendGroupMessage(uid: string, text: string): Promise<void> {
    const safeUid = uid.trim();
    const safeText = text.trim();

    if (!safeUid) {
      throw new Error("sendGroupMessage requires a non-empty uid");
    }

    if (!safeText) {
      throw new Error("sendGroupMessage requires non-empty text");
    }

    await this.postJson(
      SEND_GROUP_URL,
      {
        secret: config.luffaBotSecret,
        uid: safeUid,
        type: "1",
        msg: JSON.stringify({ text: safeText })
      },
      "sendGroupMessage"
    );
  }

  // Compatibility wrapper used by current worker loop.
  async pollMessages(_cursor?: string): Promise<LuffaPollResult> {
    const result = await this.receiveMessages();

    return {
      messages: result.messages.map((message) => ({
        messageId: message.messageId,
        sessionId: message.uid,
        senderUid: message.senderUid,
        text: message.text,
        timestamp: message.timestamp,
        isGroup: message.isGroup
      }))
    };
  }

  // Compatibility wrapper used by current worker loop.
  async sendMessage(uid: string, text: string, isGroup = false): Promise<void> {
    if (isGroup) {
      await this.sendGroupMessage(uid, text);
      return;
    }

    await this.sendDirectMessage(uid, text);
  }

  private async postJson(url: string, body: Record<string, unknown>, operation: string): Promise<any> {
    try {
      const response = await this.http.post(url, body);
      const responseBody = response.data;

      if (isFailureBody(responseBody)) {
        console.error(`[LuffaApi] ${operation} API failure`, {
          status: response.status,
          body: responseBody
        });
        throw new Error(`${operation} failed with API error response`);
      }

      return responseBody;
    } catch (error) {
      this.logHttpError(operation, error);
      throw error;
    }
  }

  private logHttpError(operation: string, error: unknown): void {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      console.error(`[LuffaApi] ${operation} HTTP failure`, {
        status: axiosError.response?.status ?? null,
        body: axiosError.response?.data ?? null,
        message: axiosError.message
      });
      return;
    }

    console.error(`[LuffaApi] ${operation} unexpected failure`, {
      message: error instanceof Error ? error.message : String(error)
    });
  }
}
