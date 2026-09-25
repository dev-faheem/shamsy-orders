/** The prototype's "exchange difference" box: white, thin border, thick coloured left edge. */
export function Notice({ tone, children }: { tone: "info" | "warn" | "error" | "ok"; children: React.ReactNode }) {
  const cls = {
    error: "border-[#f3c9c5] border-s-urgent text-red-ink",
    warn: "border-gold-l border-s-warn text-ink",
    info: "border-gold-l border-s-gold text-ink",
    ok: "border-[#bfe3cc] border-s-ok text-ok-ink",
  }[tone];
  return (
    <p role={tone === "error" ? "alert" : "status"} className={`rounded-[4px] border border-s-4 bg-white px-4 py-3 text-[13px] font-semibold ${cls}`}>
      {children}
    </p>
  );
}
