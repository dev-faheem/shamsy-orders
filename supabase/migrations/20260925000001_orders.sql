-- Shamsy order screen: schema, rules and permissions.
--
-- Design rules (from the project brief):
--   * Money is stored as integers in the smallest unit: USD cents, SDG piastres (1/100 pound).
--   * Every order stores its own rate. A saved order and its lines can never be updated or deleted.
--   * The discount rule (sand <= 3% < red <= 5% < blocked) is enforced HERE, in the database,
--     by a trigger on order_lines. No client, API route or even a service-role insert can bypass it.
--   * Every table carries tenant_id so dealer environments can be added later without a rewrite.
--   * Thresholds and rates are settings per tenant, never constants in code.

create extension if not exists pgcrypto;

create schema if not exists private;  -- helpers; NOT exposed through the API
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create type public.app_role as enum ('owner', 'marketing', 'adviser', 'warehouse');

create table public.tenants (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now()
);

create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  tenant_id     uuid not null references public.tenants (id),
  full_name     text not null,
  role          public.app_role not null,
  order_prefix  text not null check (order_prefix ~ '^[A-Z]{2,4}$'),
  created_at    timestamptz not null default now(),
  unique (tenant_id, order_prefix)
);

create table public.settings (
  tenant_id              uuid primary key references public.tenants (id),
  day_rate_sdg_per_usd   integer not null check (day_rate_sdg_per_usd > 0),
  min_rate_sdg_per_usd   integer not null check (min_rate_sdg_per_usd > 0),
  discount_sand_max_bp   integer not null default 300 check (discount_sand_max_bp between 0 and 10000),
  discount_red_max_bp    integer not null default 500 check (discount_red_max_bp between 0 and 10000),
  updated_at             timestamptz not null default now(),
  updated_by             uuid references auth.users (id),
  check (discount_sand_max_bp <= discount_red_max_bp),
  check (day_rate_sdg_per_usd >= min_rate_sdg_per_usd)
);

create table public.products (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants (id),
  sku              text not null,
  name             text not null,
  price_usd_cents  bigint not null check (price_usd_cents >= 0),
  active           boolean not null default true,
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now(),
  unique (tenant_id, sku)
);

create table public.customers (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id),
  name        text not null,
  city        text not null,
  created_at  timestamptz not null default now()
);

-- A request by an adviser to give more than the red threshold on one specific line.
-- An approval is bound to customer, product, quantity, price and discount, and can be used once.
create table public.discount_approvals (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants (id),
  requested_by          uuid not null references public.profiles (id),
  customer_id           uuid not null references public.customers (id),
  product_id            uuid not null references public.products (id),
  quantity              integer not null check (quantity > 0),
  unit_price_usd_cents  bigint not null check (unit_price_usd_cents >= 0),
  discount_usd_cents    bigint not null check (discount_usd_cents > 0),
  discount_bp           integer not null,
  status                text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_by            uuid references public.profiles (id),
  decided_at            timestamptz,
  used_at               timestamptz,
  created_at            timestamptz not null default now(),
  check ((status = 'pending') = (decided_by is null))
);

create table public.orders (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants (id),
  order_number          text not null,
  client_ref            uuid not null,  -- generated on the phone; makes offline retries idempotent
  customer_id           uuid not null references public.customers (id),
  adviser_id            uuid not null references public.profiles (id),
  rate_sdg_per_usd      integer not null check (rate_sdg_per_usd between 1 and 1000000),
  total_usd_cents       bigint not null check (total_usd_cents >= 0),
  total_sdg_piastres    bigint not null,
  created_at            timestamptz not null default now(),
  unique (tenant_id, order_number),
  unique (tenant_id, client_ref),
  -- cents × (SDG per USD) = piastres, exactly. The pound amount can never drift from the rate.
  check (total_sdg_piastres = total_usd_cents * rate_sdg_per_usd)
);

create table public.order_lines (
  id                     uuid primary key default gen_random_uuid(),
  order_id               uuid not null references public.orders (id),
  tenant_id              uuid not null references public.tenants (id),
  line_no                integer not null check (line_no > 0),
  product_id             uuid not null references public.products (id),
  product_name           text not null,           -- snapshot: renaming a product never rewrites history
  unit_price_usd_cents   bigint not null check (unit_price_usd_cents >= 0),  -- snapshot of the price used
  catalogue_price_usd_cents bigint not null check (catalogue_price_usd_cents >= 0),
  quantity               integer not null check (quantity > 0),
  line_value_usd_cents   bigint not null,
  discount_usd_cents     bigint not null check (discount_usd_cents >= 0),
  discount_bp            integer not null,
  discount_tier          text not null check (discount_tier in ('none', 'sand', 'red', 'blocked')),
  line_total_usd_cents   bigint not null,
  approval_id            uuid unique references public.discount_approvals (id),
  approved_by            uuid references public.profiles (id),
  created_at             timestamptz not null default now(),
  unique (order_id, line_no),
  check (line_value_usd_cents = unit_price_usd_cents * quantity),
  check (discount_usd_cents <= line_value_usd_cents),
  check (line_total_usd_cents = line_value_usd_cents - discount_usd_cents),
  check ((discount_tier = 'blocked') = (approval_id is not null)),
  check ((approval_id is null) = (approved_by is null))
);

create table public.order_number_counters (
  tenant_id  uuid not null references public.tenants (id),
  prefix     text not null,
  last_value integer not null default 0,
  primary key (tenant_id, prefix)
);

-- Who changed what, when — for the settings and prices the owner changes daily.
create table public.audit_log (
  id          bigint generated always as identity primary key,
  tenant_id   uuid not null,
  table_name  text not null,
  row_id      text not null,
  action      text not null,
  old_row     jsonb,
  new_row     jsonb,
  changed_by  uuid,
  changed_at  timestamptz not null default now()
);

create index on public.orders (tenant_id, created_at desc);
create index on public.orders (adviser_id, created_at desc);
create index on public.order_lines (order_id);
create index on public.discount_approvals (tenant_id, status, created_at desc);

-- ---------------------------------------------------------------------------
-- Helpers (private schema, not callable through the API)
-- ---------------------------------------------------------------------------

create function private.my_profile() returns public.profiles
language sql stable security definer set search_path = '' as $$
  select p.* from public.profiles p where p.id = auth.uid()
$$;

create function private.my_tenant() returns uuid
language sql stable security definer set search_path = '' as $$
  select p.tenant_id from public.profiles p where p.id = auth.uid()
$$;

create function private.my_role() returns public.app_role
language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p where p.id = auth.uid()
$$;

-- Same integer formulas as src/lib/money.ts. Kept in one place in SQL.
create function private.discount_bp(p_discount bigint, p_value bigint) returns integer
language sql immutable set search_path = '' as $$
  select case when p_value = 0 then 0
              else floor((2 * p_discount * 10000 + p_value)::numeric / (2 * p_value))::integer end
$$;

create function private.discount_tier(p_discount bigint, p_value bigint, p_sand_bp integer, p_red_bp integer)
returns text language sql immutable set search_path = '' as $$
  select case
    when p_discount <= 0 then 'none'
    when p_discount * 10000 <= p_value * p_sand_bp then 'sand'
    when p_discount * 10000 <= p_value * p_red_bp then 'red'
    else 'blocked'
  end
$$;

create function private.raise_app_error(p_code text, p_message text) returns void
language plpgsql set search_path = '' as $$
begin
  -- The code travels to the client in "hint"; the message is human-readable.
  raise exception using errcode = 'P0001', message = p_message, hint = p_code;
end
$$;

-- ---------------------------------------------------------------------------
-- Integrity triggers — these hold no matter who inserts (API, RPC, service role)
-- ---------------------------------------------------------------------------

-- 1. The discount rule, verified on every order line.
create function private.check_order_line() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  s public.settings;
  o public.orders;
  a public.discount_approvals;
  expected_tier text;
begin
  select * into o from public.orders where id = new.order_id;
  if o.id is null or o.tenant_id <> new.tenant_id then
    perform private.raise_app_error('INVALID_ORDER', 'Order line does not belong to a valid order');
  end if;
  select * into s from public.settings where tenant_id = new.tenant_id;

  if new.discount_bp <> private.discount_bp(new.discount_usd_cents, new.line_value_usd_cents) then
    perform private.raise_app_error('INVALID_LINE', 'Discount percentage does not match the amounts');
  end if;
  expected_tier := private.discount_tier(new.discount_usd_cents, new.line_value_usd_cents,
                                         s.discount_sand_max_bp, s.discount_red_max_bp);
  if new.discount_tier <> expected_tier then
    perform private.raise_app_error('INVALID_LINE', 'Discount colour does not match the thresholds');
  end if;

  if expected_tier = 'blocked' then
    if new.approval_id is null then
      perform private.raise_app_error('DISCOUNT_NEEDS_APPROVAL',
        format('Line %s: a discount of %s%% is above %s%% and needs the owner''s approval',
               new.line_no, to_char(new.discount_bp / 100.0, 'FM990.00'),
               to_char(s.discount_red_max_bp / 100.0, 'FM990.00')));
    end if;
    select * into a from public.discount_approvals where id = new.approval_id for update;
    if a.id is null
       or a.status <> 'approved'
       or a.used_at is not null
       or a.tenant_id <> new.tenant_id
       or a.customer_id <> o.customer_id
       or a.product_id <> new.product_id
       or a.quantity <> new.quantity
       or a.unit_price_usd_cents <> new.unit_price_usd_cents
       or a.discount_usd_cents <> new.discount_usd_cents
       or not exists (select 1 from public.profiles p
                      where p.id = a.decided_by and p.role = 'owner' and p.tenant_id = new.tenant_id)
    then
      perform private.raise_app_error('APPROVAL_INVALID',
        format('Line %s: the approval is missing, not yet approved, already used, or does not match this line', new.line_no));
    end if;
    if new.approved_by <> a.decided_by then
      perform private.raise_app_error('APPROVAL_INVALID', 'approved_by must be the owner who approved');
    end if;
    update public.discount_approvals set used_at = now() where id = a.id;
  end if;
  return new;
end
$$;

create trigger order_lines_check before insert on public.order_lines
  for each row execute function private.check_order_line();

-- 2. The minimum rate, verified on every order.
create function private.check_order() returns trigger
language plpgsql security definer set search_path = '' as $$
declare s public.settings;
begin
  select * into s from public.settings where tenant_id = new.tenant_id;
  if s.tenant_id is null then
    perform private.raise_app_error('NO_SETTINGS', 'This environment has no settings');
  end if;
  if new.rate_sdg_per_usd < s.min_rate_sdg_per_usd then
    perform private.raise_app_error('RATE_BELOW_MINIMUM',
      format('The rate %s is below the minimum rate of %s SDG per USD', new.rate_sdg_per_usd, s.min_rate_sdg_per_usd));
  end if;
  return new;
end
$$;

create trigger orders_check before insert on public.orders
  for each row execute function private.check_order();

-- 3. Order total = sum of its lines, checked when the transaction commits.
create function private.check_order_total() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  o public.orders;
  target uuid;
  line_sum bigint;
  line_count integer;
begin
  if tg_table_name = 'orders' then
    target := new.id;
  else
    target := new.order_id;
  end if;
  select * into o from public.orders where id = target;
  select coalesce(sum(line_total_usd_cents), 0), count(*) into line_sum, line_count
    from public.order_lines where order_id = o.id;
  if line_count = 0 then
    perform private.raise_app_error('EMPTY_ORDER', 'An order needs at least one line');
  end if;
  if line_sum <> o.total_usd_cents then
    perform private.raise_app_error('INVALID_TOTAL', 'Order total does not equal the sum of its lines');
  end if;
  return null;
end
$$;

create constraint trigger orders_total_check after insert on public.orders
  deferrable initially deferred for each row execute function private.check_order_total();
create constraint trigger order_lines_total_check after insert on public.order_lines
  deferrable initially deferred for each row execute function private.check_order_total();

-- 4. History never moves: saved orders and lines are append-only, for every role.
create function private.forbid_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  perform private.raise_app_error('ORDER_IMMUTABLE', 'A saved order can never be changed or deleted');
  return null;
end
$$;

create trigger orders_immutable before update or delete on public.orders
  for each row execute function private.forbid_change();
create trigger order_lines_immutable before update or delete on public.order_lines
  for each row execute function private.forbid_change();
create trigger orders_no_truncate before truncate on public.orders
  for each statement execute function private.forbid_change();
create trigger order_lines_no_truncate before truncate on public.order_lines
  for each statement execute function private.forbid_change();

-- 5. Audit trail for settings and prices.
create function private.audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  old_j jsonb;
  new_j jsonb;
  row_j jsonb;
begin
  if tg_op <> 'INSERT' then old_j := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then new_j := to_jsonb(new); end if;
  row_j := coalesce(new_j, old_j);
  insert into public.audit_log (tenant_id, table_name, row_id, action, old_row, new_row, changed_by)
  values ((row_j ->> 'tenant_id')::uuid, tg_table_name, coalesce(row_j ->> 'id', row_j ->> 'tenant_id'),
          tg_op, old_j, new_j, auth.uid());
  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$$;

create trigger settings_audit after insert or update on public.settings
  for each row execute function private.audit();
create trigger products_audit after insert or update or delete on public.products
  for each row execute function private.audit();
create trigger discount_approvals_audit after insert or update on public.discount_approvals
  for each row execute function private.audit();

-- ---------------------------------------------------------------------------
-- Row level security: reads only. All writes go through the functions below.
-- ---------------------------------------------------------------------------

alter table public.tenants enable row level security;
alter table public.profiles enable row level security;
alter table public.settings enable row level security;
alter table public.products enable row level security;
alter table public.customers enable row level security;
alter table public.discount_approvals enable row level security;
alter table public.orders enable row level security;
alter table public.order_lines enable row level security;
alter table public.order_number_counters enable row level security;
alter table public.audit_log enable row level security;

revoke all on all tables in schema public from anon;
revoke insert, update, delete, truncate on all tables in schema public from authenticated;
grant select on all tables in schema public to authenticated;

create policy "own tenant" on public.tenants for select to authenticated
  using (id = private.my_tenant());
create policy "same tenant" on public.profiles for select to authenticated
  using (tenant_id = private.my_tenant());
create policy "same tenant" on public.settings for select to authenticated
  using (tenant_id = private.my_tenant());
create policy "same tenant" on public.products for select to authenticated
  using (tenant_id = private.my_tenant());
create policy "same tenant" on public.customers for select to authenticated
  using (tenant_id = private.my_tenant());
create policy "owner sees all, adviser sees own" on public.discount_approvals for select to authenticated
  using (tenant_id = private.my_tenant()
         and (private.my_role() = 'owner' or requested_by = auth.uid()));
create policy "owner sees all, adviser sees own" on public.orders for select to authenticated
  using (tenant_id = private.my_tenant()
         and (private.my_role() in ('owner', 'marketing', 'warehouse') or adviser_id = auth.uid()));
create policy "lines of visible orders" on public.order_lines for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id));
create policy "owner only" on public.audit_log for select to authenticated
  using (tenant_id = private.my_tenant() and private.my_role() = 'owner');
-- order_number_counters: no policy → invisible.

-- ---------------------------------------------------------------------------
-- API functions
-- ---------------------------------------------------------------------------

-- Save an order. The only way to create one.
-- p_lines: [{ "product_id": uuid, "quantity": int, "discount_usd_cents": int,
--             "unit_price_usd_cents"?: int (owner only), "approval_id"?: uuid }]
create function public.place_order(p_client_ref uuid, p_customer_id uuid, p_rate integer, p_lines jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  s public.settings;
  existing public.orders;
  new_order public.orders;
  prod public.products;
  line jsonb;
  i integer := 0;
  qty integer;
  price bigint;
  disc bigint;
  line_value bigint;
  approval uuid;
  approver uuid;
  tier text;
  total bigint := 0;
  seq integer;
  prepared jsonb := '[]'::jsonb;
begin
  me := private.my_profile();
  if me.id is null then
    perform private.raise_app_error('NOT_AUTHENTICATED', 'Sign in first');
  end if;
  if me.role not in ('owner', 'adviser') then
    perform private.raise_app_error('FORBIDDEN', 'Only advisers and the owner can record orders');
  end if;
  if p_client_ref is null or p_customer_id is null or p_rate is null then
    perform private.raise_app_error('INVALID_INPUT', 'client_ref, customer and rate are required');
  end if;

  -- Idempotent: a retry from a phone that lost its connection returns the order already saved.
  select * into existing from public.orders where tenant_id = me.tenant_id and client_ref = p_client_ref;
  if existing.id is not null then
    if existing.adviser_id <> me.id then
      perform private.raise_app_error('INVALID_INPUT', 'This client_ref belongs to another user');
    end if;
    return public.order_json(existing.id) || jsonb_build_object('replayed', true);
  end if;

  select * into s from public.settings where tenant_id = me.tenant_id;
  if p_rate < s.min_rate_sdg_per_usd then
    perform private.raise_app_error('RATE_BELOW_MINIMUM',
      format('The rate %s is below the minimum rate of %s SDG per USD', p_rate, s.min_rate_sdg_per_usd));
  end if;
  if not exists (select 1 from public.customers where id = p_customer_id and tenant_id = me.tenant_id) then
    perform private.raise_app_error('INVALID_INPUT', 'Unknown customer');
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    perform private.raise_app_error('EMPTY_ORDER', 'An order needs at least one line');
  end if;
  if jsonb_array_length(p_lines) > 100 then
    perform private.raise_app_error('INVALID_INPUT', 'Too many lines');
  end if;

  for line in select * from jsonb_array_elements(p_lines) loop
    i := i + 1;
    if jsonb_typeof(line -> 'quantity') <> 'number' or jsonb_typeof(line -> 'discount_usd_cents') not in ('number')
       or (line ->> 'quantity') !~ '^\d+$' or (line ->> 'discount_usd_cents') !~ '^\d+$' then
      perform private.raise_app_error('INVALID_INPUT', format('Line %s: quantity and discount must be whole numbers (cents)', i));
    end if;
    qty := (line ->> 'quantity')::integer;
    disc := (line ->> 'discount_usd_cents')::bigint;
    if qty < 1 or qty > 100000 then
      perform private.raise_app_error('INVALID_INPUT', format('Line %s: quantity must be between 1 and 100,000', i));
    end if;

    select * into prod from public.products
      where id = (line ->> 'product_id')::uuid and tenant_id = me.tenant_id and active;
    if prod.id is null then
      perform private.raise_app_error('INVALID_INPUT', format('Line %s: unknown product', i));
    end if;

    -- Prices are fixed. Only the owner may override one, per line.
    price := prod.price_usd_cents;
    if line ? 'unit_price_usd_cents' and line -> 'unit_price_usd_cents' <> 'null'::jsonb then
      if (line ->> 'unit_price_usd_cents') !~ '^\d+$' then
        perform private.raise_app_error('INVALID_INPUT', format('Line %s: price must be whole cents', i));
      end if;
      if (line ->> 'unit_price_usd_cents')::bigint <> prod.price_usd_cents and me.role <> 'owner' then
        perform private.raise_app_error('PRICE_LOCKED', format('Line %s: prices are fixed; only the owner can change a price', i));
      end if;
      price := (line ->> 'unit_price_usd_cents')::bigint;
    end if;

    line_value := price * qty;
    if disc > line_value then
      perform private.raise_app_error('INVALID_INPUT', format('Line %s: the discount is larger than the line', i));
    end if;
    tier := private.discount_tier(disc, line_value, s.discount_sand_max_bp, s.discount_red_max_bp);

    approval := null;
    approver := null;
    if tier = 'blocked' then
      approval := nullif(line ->> 'approval_id', '')::uuid;
      if approval is null then
        perform private.raise_app_error('DISCOUNT_NEEDS_APPROVAL',
          format('Line %s: a discount of %s%% is above %s%% and needs the owner''s approval',
                 i, to_char(private.discount_bp(disc, line_value) / 100.0, 'FM990.00'),
                 to_char(s.discount_red_max_bp / 100.0, 'FM990.00')));
      end if;
      select decided_by into approver from public.discount_approvals
        where id = approval and tenant_id = me.tenant_id and status = 'approved'
          and (requested_by = me.id or me.role = 'owner');
      if approver is null then
        perform private.raise_app_error('APPROVAL_INVALID',
          format('Line %s: the approval is missing, not yet approved, or not yours', i));
      end if;
    end if;

    total := total + (line_value - disc);
    prepared := prepared || jsonb_build_object(
      'line_no', i, 'product_id', prod.id, 'product_name', prod.name,
      'unit_price', price, 'catalogue_price', prod.price_usd_cents, 'quantity', qty,
      'line_value', line_value, 'discount', disc, 'tier', tier,
      'approval_id', approval, 'approved_by', approver);
  end loop;

  insert into public.order_number_counters as c (tenant_id, prefix, last_value)
    values (me.tenant_id, me.order_prefix, 1)
    on conflict (tenant_id, prefix) do update set last_value = c.last_value + 1
    returning last_value into seq;

  insert into public.orders (tenant_id, order_number, client_ref, customer_id, adviser_id,
                             rate_sdg_per_usd, total_usd_cents, total_sdg_piastres)
  values (me.tenant_id, me.order_prefix || '-' || lpad(seq::text, 4, '0'), p_client_ref, p_customer_id, me.id,
          p_rate, total, total * p_rate)
  returning * into new_order;

  insert into public.order_lines (order_id, tenant_id, line_no, product_id, product_name,
         unit_price_usd_cents, catalogue_price_usd_cents, quantity, line_value_usd_cents,
         discount_usd_cents, discount_bp, discount_tier, line_total_usd_cents, approval_id, approved_by)
  select new_order.id, me.tenant_id, (l ->> 'line_no')::int, (l ->> 'product_id')::uuid, l ->> 'product_name',
         (l ->> 'unit_price')::bigint, (l ->> 'catalogue_price')::bigint, (l ->> 'quantity')::int,
         (l ->> 'line_value')::bigint, (l ->> 'discount')::bigint,
         private.discount_bp((l ->> 'discount')::bigint, (l ->> 'line_value')::bigint), l ->> 'tier',
         (l ->> 'line_value')::bigint - (l ->> 'discount')::bigint,
         nullif(l ->> 'approval_id', '')::uuid, nullif(l ->> 'approved_by', '')::uuid
  from jsonb_array_elements(prepared) l;

  return public.order_json(new_order.id) || jsonb_build_object('replayed', false);
end
$$;

-- An order with its lines, as stored. Used by place_order and the order view.
create function public.order_json(p_order_id uuid) returns jsonb
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
        'approval_id', l.approval_id, 'approved_by', l.approved_by) order by l.line_no)
      from public.order_lines l where l.order_id = o.id), '[]'::jsonb))
  from public.orders o
  join public.customers c on c.id = o.customer_id
  join public.profiles p on p.id = o.adviser_id
  where o.id = p_order_id
$$;

-- Ask for (adviser) or give (owner) approval for one blocked line.
create function public.request_discount_approval(p_customer_id uuid, p_product_id uuid, p_quantity integer,
                                                 p_discount_usd_cents bigint, p_unit_price_usd_cents bigint default null)
returns public.discount_approvals language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  s public.settings;
  prod public.products;
  price bigint;
  result public.discount_approvals;
begin
  me := private.my_profile();
  if me.id is null or me.role not in ('owner', 'adviser') then
    perform private.raise_app_error('FORBIDDEN', 'Only advisers and the owner can request a discount');
  end if;
  select * into s from public.settings where tenant_id = me.tenant_id;
  select * into prod from public.products where id = p_product_id and tenant_id = me.tenant_id and active;
  if prod.id is null or not exists (select 1 from public.customers where id = p_customer_id and tenant_id = me.tenant_id) then
    perform private.raise_app_error('INVALID_INPUT', 'Unknown product or customer');
  end if;
  price := coalesce(p_unit_price_usd_cents, prod.price_usd_cents);
  if price <> prod.price_usd_cents and me.role <> 'owner' then
    perform private.raise_app_error('PRICE_LOCKED', 'Prices are fixed; only the owner can change a price');
  end if;
  if p_quantity is null or p_quantity < 1 or p_discount_usd_cents is null or p_discount_usd_cents < 1
     or p_discount_usd_cents > price * p_quantity then
    perform private.raise_app_error('INVALID_INPUT', 'Invalid quantity or discount');
  end if;
  if private.discount_tier(p_discount_usd_cents, price * p_quantity, s.discount_sand_max_bp, s.discount_red_max_bp) <> 'blocked' then
    perform private.raise_app_error('APPROVAL_NOT_NEEDED', 'This discount does not need approval');
  end if;

  insert into public.discount_approvals (tenant_id, requested_by, customer_id, product_id, quantity,
         unit_price_usd_cents, discount_usd_cents, discount_bp, status, decided_by, decided_at)
  values (me.tenant_id, me.id, p_customer_id, p_product_id, p_quantity, price, p_discount_usd_cents,
          private.discount_bp(p_discount_usd_cents, price * p_quantity),
          case when me.role = 'owner' then 'approved' else 'pending' end,
          case when me.role = 'owner' then me.id end,
          case when me.role = 'owner' then now() end)
  returning * into result;
  return result;
end
$$;

create function public.decide_discount_approval(p_approval_id uuid, p_approve boolean)
returns public.discount_approvals language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  result public.discount_approvals;
begin
  me := private.my_profile();
  if me.id is null or me.role <> 'owner' then
    perform private.raise_app_error('FORBIDDEN', 'Only the owner can approve a discount');
  end if;
  update public.discount_approvals
     set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = me.id, decided_at = now()
   where id = p_approval_id and tenant_id = me.tenant_id and status = 'pending'
  returning * into result;
  if result.id is null then
    perform private.raise_app_error('INVALID_INPUT', 'No pending approval with that id');
  end if;
  return result;
end
$$;

-- The owner sets the day's rate and the minimum rate. Saved orders are not affected.
create function public.set_rates(p_day_rate integer, p_min_rate integer)
returns public.settings language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  result public.settings;
begin
  me := private.my_profile();
  if me.id is null or me.role <> 'owner' then
    perform private.raise_app_error('FORBIDDEN', 'Only the owner can change the rates');
  end if;
  if p_day_rate is null or p_min_rate is null or p_min_rate < 1 or p_day_rate < p_min_rate then
    perform private.raise_app_error('INVALID_INPUT', 'The day''s rate must be at least the minimum rate');
  end if;
  update public.settings set day_rate_sdg_per_usd = p_day_rate, min_rate_sdg_per_usd = p_min_rate,
         updated_at = now(), updated_by = me.id
   where tenant_id = me.tenant_id
  returning * into result;
  return result;
end
$$;

create function public.set_product_price(p_product_id uuid, p_price_usd_cents bigint)
returns public.products language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  result public.products;
begin
  me := private.my_profile();
  if me.id is null or me.role <> 'owner' then
    perform private.raise_app_error('FORBIDDEN', 'Only the owner can change a price');
  end if;
  if p_price_usd_cents is null or p_price_usd_cents < 0 then
    perform private.raise_app_error('INVALID_INPUT', 'Invalid price');
  end if;
  update public.products set price_usd_cents = p_price_usd_cents
   where id = p_product_id and tenant_id = me.tenant_id
  returning * into result;
  if result.id is null then
    perform private.raise_app_error('INVALID_INPUT', 'Unknown product');
  end if;
  return result;
end
$$;

-- Only signed-in users can call the API functions.
revoke execute on all functions in schema public from public, anon;
grant execute on function public.place_order(uuid, uuid, integer, jsonb) to authenticated;
grant execute on function public.order_json(uuid) to authenticated;
grant execute on function public.request_discount_approval(uuid, uuid, integer, bigint, bigint) to authenticated;
grant execute on function public.decide_discount_approval(uuid, boolean) to authenticated;
grant execute on function public.set_rates(integer, integer) to authenticated;
grant execute on function public.set_product_price(uuid, bigint) to authenticated;
revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;
