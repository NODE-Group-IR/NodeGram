import {
  ERROR_MESSAGES,
  STATUS_FOR_CODE,
  type ErrorCode,
  type NodeGramErrorBody,
} from "./domain.js";

export interface DoResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
}

const BASE_SECURITY_HEADERS: Record<string, string> = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "content-type": "application/json; charset=utf-8",
};

export function errorEnvelope(code: ErrorCode, requestId: string): NodeGramErrorBody {
  return {
    ok: false,
    error: {
      code,
      message: ERROR_MESSAGES[code],
      request_id: requestId,
    },
  };
}

export function jsonResponse(
  statusCode: number,
  body: unknown,
  extraHeaders?: Record<string, string>,
): DoResponse {
  return {
    statusCode,
    headers: {
      ...BASE_SECURITY_HEADERS,
      ...extraHeaders,
    },
    body,
  };
}

export function nodegramError(
  code: ErrorCode,
  requestId: string,
  extraHeaders?: Record<string, string>,
): DoResponse {
  return jsonResponse(STATUS_FOR_CODE[code], errorEnvelope(code, requestId), extraHeaders);
}

export function telegramPassthrough(
  status: number,
  body: unknown,
  retryAfter: string | undefined,
  extraHeaders?: Record<string, string>,
): DoResponse {
  const headers: Record<string, string> = {
    ...BASE_SECURITY_HEADERS,
    ...extraHeaders,
  };
  if (retryAfter !== undefined) {
    headers["retry-after"] = retryAfter;
  }
  return {
    statusCode: status,
    headers,
    body,
  };
}
