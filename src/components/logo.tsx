import { t } from "@/i18n/en";

/** Text wordmark in the house colours. The real logo files arrive with the brand assets. */
export function Logo() {
  return (
    <span className="inline-flex items-center gap-2 text-white">
      <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
        <circle cx="13" cy="13" r="6" fill="#C9922E" />
        {Array.from({ length: 8 }, (_, i) => {
          const a = (i * Math.PI) / 4;
          return (
            <line
              key={i}
              x1={13 + Math.cos(a) * 9}
              y1={13 + Math.sin(a) * 9}
              x2={13 + Math.cos(a) * 12}
              y2={13 + Math.sin(a) * 12}
              stroke="#E0B45C"
              strokeWidth="2"
              strokeLinecap="round"
            />
          );
        })}
      </svg>
      <span className="text-lg font-bold tracking-wide">{t.app.name}</span>
      <span className="text-sm text-gold-l">{t.app.tagline}</span>
    </span>
  );
}
