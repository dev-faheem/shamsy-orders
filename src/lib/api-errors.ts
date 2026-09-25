/** Error codes the database raises (in the "hint" field) plus a few transport-level ones. */
export type ApiErrorCode =
  | "DISCOUNT_NEEDS_APPROVAL"
  | "APPROVAL_INVALID"
  | "APPROVAL_NOT_NEEDED"
  | "RATE_BELOW_MINIMUM"
  | "PRICE_LOCKED"
  | "EMPTY_ORDER"
  | "INVALID_INPUT"
  | "INVALID_LINE"
  | "FORBIDDEN"
  | "NOT_AUTHENTICATED"
  | "ORDER_IMMUTABLE"
  | "SERVER_ERROR"
  | (string & {});

export interface ApiError {
  code: ApiErrorCode;
  message: string;
}

interface DbError {
  message: string;
  hint?: string | null;
  code?: string | null;
}

export function toApiError(e: DbError): ApiError {
  if (e.hint && /^[A-Z_]+$/.test(e.hint)) return { code: e.hint, message: e.message };
  if (e.code === "42501") return { code: "FORBIDDEN", message: e.message };
  if (e.code?.startsWith("PGRST30")) return { code: "NOT_AUTHENTICATED", message: e.message };
  return { code: "SERVER_ERROR", message: e.message };
}

export function httpStatusFor(code: ApiErrorCode): number {
  switch (code) {
    case "NOT_AUTHENTICATED":
      return 401;
    case "FORBIDDEN":
    case "PRICE_LOCKED":
      return 403;
    case "DISCOUNT_NEEDS_APPROVAL":
    case "APPROVAL_INVALID":
    case "APPROVAL_NOT_NEEDED":
    case "RATE_BELOW_MINIMUM":
    case "EMPTY_ORDER":
    case "ORDER_IMMUTABLE":
      return 422;
    case "SERVER_ERROR":
      return 500;
    default:
      return 400;
  }
}
