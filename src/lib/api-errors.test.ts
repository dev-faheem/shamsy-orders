import { describe, expect, it } from "vitest";
import { httpStatusFor, toApiError } from "./api-errors";

describe("toApiError", () => {
  it("uses the rule code the database puts in the hint", () => {
    expect(toApiError({ message: "Line 3: needs approval", hint: "DISCOUNT_NEEDS_APPROVAL", code: "P0001" })).toEqual({
      code: "DISCOUNT_NEEDS_APPROVAL",
      message: "Line 3: needs approval",
    });
  });
  it("maps a permission error to FORBIDDEN", () => {
    expect(toApiError({ message: "permission denied for table orders", code: "42501" }).code).toBe("FORBIDDEN");
  });
  it("maps a bad JWT to NOT_AUTHENTICATED", () => {
    expect(toApiError({ message: "JWT expired", code: "PGRST303" }).code).toBe("NOT_AUTHENTICATED");
  });
  it("falls back to SERVER_ERROR", () => {
    expect(toApiError({ message: "boom" }).code).toBe("SERVER_ERROR");
  });
});

describe("httpStatusFor", () => {
  it("gives rule violations 422, permissions 401/403, bad input 400", () => {
    expect(httpStatusFor("DISCOUNT_NEEDS_APPROVAL")).toBe(422);
    expect(httpStatusFor("APPROVAL_INVALID")).toBe(422);
    expect(httpStatusFor("RATE_BELOW_MINIMUM")).toBe(422);
    expect(httpStatusFor("PRICE_LOCKED")).toBe(403);
    expect(httpStatusFor("FORBIDDEN")).toBe(403);
    expect(httpStatusFor("NOT_AUTHENTICATED")).toBe(401);
    expect(httpStatusFor("INVALID_INPUT")).toBe(400);
    expect(httpStatusFor("SERVER_ERROR")).toBe(500);
  });
});
