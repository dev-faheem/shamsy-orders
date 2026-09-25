-- The integrity triggers live in schema "private". Without usage on it, a service-role write
-- failed with "permission denied for schema private" before the real rule could run — safe,
-- but for the wrong reason. Grant it so the service role meets exactly the same rules.
grant usage on schema private to service_role;
grant execute on all functions in schema private to service_role;
