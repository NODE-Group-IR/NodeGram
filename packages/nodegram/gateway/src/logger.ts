export interface CompletionLog {
  timestamp: string;
  request_id: string;
  client_ref: string | undefined;
  /** Numeric Telegram bot id only (never the secret token suffix). */
  bot_id: string | undefined;
  method: string | undefined;
  outcome: string;
  upstream_status: number | undefined;
  duration_ms: number;
  cold_start: boolean;
}

export type LogSink = (line: string) => void;

let sink: LogSink = (line) => {
  // Structured logs only; never include secrets in callers.
  console.log(line);
};

export function setLogSinkForTests(next: LogSink | undefined): void {
  sink = next ?? ((line) => console.log(line));
}

export function writeCompletionLog(entry: CompletionLog): void {
  const payload: Record<string, unknown> = {
    timestamp: entry.timestamp,
    request_id: entry.request_id,
    outcome: entry.outcome,
    duration_ms: entry.duration_ms,
    cold_start: entry.cold_start,
  };
  if (entry.client_ref !== undefined) {
    payload.client_ref = entry.client_ref;
  }
  if (entry.bot_id !== undefined) {
    payload.bot_id = entry.bot_id;
  }
  if (entry.method !== undefined) {
    payload.method = entry.method;
  }
  if (entry.upstream_status !== undefined) {
    payload.upstream_status = entry.upstream_status;
  }
  sink(JSON.stringify(payload));
}

export function writeConfigErrorLog(reason: string, requestId: string): void {
  sink(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      request_id: requestId,
      outcome: "CONFIGURATION_ERROR",
      reason_code: reason,
    }),
  );
}
