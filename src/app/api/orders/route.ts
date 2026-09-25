import { NextResponse, type NextRequest } from "next/server";
import { httpStatusFor, toApiError } from "@/lib/api-errors";
import { supabaseForBearer, supabaseServer } from "@/lib/supabase/server";

/**
 * POST /api/orders — save an order.
 *
 * Auth: the session cookie (the app) or `Authorization: Bearer <access token>` (scripts, tests).
 * This route only forwards to the database function `place_order`, which recomputes every amount
 * from the catalogue and enforces every rule. Nothing sent here is trusted: prices, percentages,
 * colours and totals from the client are ignored or checked.
 *
 * Body: { client_ref, customer_id, rate, lines: [{ product_id, quantity, discount_usd_cents,
 *         unit_price_usd_cents?, approval_id? }] }
 * 201 → the saved order. 200 → the same order, already saved earlier with this client_ref.
 * 4xx → { code, message }, e.g. 422 DISCOUNT_NEEDS_APPROVAL.
 */
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ code: "INVALID_INPUT", message: "Body must be JSON" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null || !Array.isArray(body.lines)) {
    return NextResponse.json({ code: "INVALID_INPUT", message: "Expected { client_ref, customer_id, rate, lines[] }" }, { status: 400 });
  }

  const auth = request.headers.get("authorization");
  const token = auth?.match(/^Bearer (.+)$/i)?.[1];
  const supabase = token ? supabaseForBearer(token) : await supabaseServer();

  const { data, error } = await supabase.rpc("place_order", {
    p_client_ref: body.client_ref,
    p_customer_id: body.customer_id,
    p_rate: body.rate,
    p_lines: body.lines,
  });

  if (error) {
    const e = toApiError(error);
    return NextResponse.json(e, { status: httpStatusFor(e.code) });
  }
  return NextResponse.json(data, { status: data?.replayed ? 200 : 201 });
}
