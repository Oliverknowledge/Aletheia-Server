export interface SessionState {
  runId: string;
  updatedAt: number;
}

export class SessionStore {
  private readonly sessions = new Map<string, SessionState>();

  get(sessionId: string): SessionState | undefined {
    return this.sessions.get(sessionId);
  }

  set(sessionId: string, runId: string): void {
    this.sessions.set(sessionId, {
      runId,
      updatedAt: Date.now()
    });
  }

  clear(sessionId: string): void {
    this.sessions.delete(sessionId);
  }
}
