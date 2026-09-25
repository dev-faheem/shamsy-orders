-- The order view showed "Approved by …" with a second query for the approver's name.
-- Return it with the order, so the page needs one round trip to the database, not two.
create or replace function public.order_json(p_order_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'id', o.id, 'order_number', o.order_number, 'client_ref', o.client_ref,
    'customer_id', o.customer_id, 'customer_name', c.name, 'customer_city', c.city,
    'adviser_id', o.adviser_id, 'adviser_name', p.full_name,
    'rate_sdg_per_usd', o.rate_sdg_per_usd, 'total_usd_cents', o.total_usd_cents,
    'total_sdg_piastres', o.total_sdg_piastres, 'created_at', o.created_at,
    'lines', coalesce((select jsonb_agg(jsonb_build_object(
        'line_no', l.line_no, 'product_id', l.product_id, 'product_name', l.product_name,
        'unit_price_usd_cents', l.unit_price_usd_cents, 'catalogue_price_usd_cents', l.catalogue_price_usd_cents,
        'quantity', l.quantity, 'line_value_usd_cents', l.line_value_usd_cents,
        'discount_usd_cents', l.discount_usd_cents, 'discount_bp', l.discount_bp,
        'discount_tier', l.discount_tier, 'line_total_usd_cents', l.line_total_usd_cents,
        'approval_id', l.approval_id, 'approved_by', l.approved_by,
        'approved_by_name', ap.full_name) order by l.line_no)
      from public.order_lines l
      left join public.profiles ap on ap.id = l.approved_by
      where l.order_id = o.id), '[]'::jsonb))
  from public.orders o
  join public.customers c on c.id = o.customer_id
  join public.profiles p on p.id = o.adviser_id
  where o.id = p_order_id
$$;
