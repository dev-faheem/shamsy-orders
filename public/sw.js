// Keeps the order screen usable on a dropped connection.
// Pages: network first, fall back to the last copy. Build assets: cache first (their names are hashed).
// Never caches the API or Supabase — orders go through the outbox in the page, not through here.
const CACHE = "shamsy-v2";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** Stores a copy. The copy must be taken before the page reads the body. */
function keep(event, request, response) {
  if (!response.ok || response.redirected || response.type === "opaqueredirect") return;
  const copy = response.clone();
  event.waitUntil(caches.open(CACHE).then((c) => c.put(request, copy)));
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            keep(event, req, res);
            return res;
          }),
      ),
    );
    return;
  }

  if (req.mode === "navigate") {
    // Stored by path only, so a reload or a link with other headers still finds it.
    const key = new Request(url.origin + url.pathname);
    event.respondWith(
      fetch(req)
        .then((res) => {
          keep(event, key, res);
          return res;
        })
        .catch(
          async () =>
            (await caches.match(key, { ignoreVary: true })) ||
            (await caches.match(new Request(url.origin + "/orders/new"), { ignoreVary: true })) ||
            Response.error(),
        ),
    );
  }
});

self.addEventListener("message", (event) => {
  if (event.data === "clear") event.waitUntil(caches.delete(CACHE));
});
