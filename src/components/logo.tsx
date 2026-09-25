/** The Shamsy logo, as drawn in the dashboard prototype (shamsy-dashboard-v2.html). */
export function Logo({ className = "w-[170px]" }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 52" className={`block h-auto ${className}`} role="img" aria-label="Shamsy — Solar & Energy">
      <g transform="translate(2, 2)">
        <circle cx="24" cy="24" r="9" fill="#C9922E" />
        <path d="M 24 5 A 19 19 0 0 1 43 24" fill="none" stroke="#E0B45C" strokeWidth="3.5" strokeLinecap="round" />
        <path d="M 24 43 A 19 19 0 0 1 5 24" fill="none" stroke="#E0B45C" strokeWidth="3.5" strokeLinecap="round" />
        <line x1="24" y1="10" x2="24" y2="13" stroke="#0E3B2E" strokeWidth="2.5" strokeLinecap="round" />
        <line x1="24" y1="35" x2="24" y2="38" stroke="#0E3B2E" strokeWidth="2.5" strokeLinecap="round" />
        <line x1="10" y1="24" x2="13" y2="24" stroke="#0E3B2E" strokeWidth="2.5" strokeLinecap="round" />
        <line x1="35" y1="24" x2="38" y2="24" stroke="#0E3B2E" strokeWidth="2.5" strokeLinecap="round" />
      </g>
      <text x="60" y="33" fontFamily="-apple-system, BlinkMacSystemFont, sans-serif" fontSize="28" fontWeight="800" fontStyle="italic" fill="#C9922E" letterSpacing="0.5">
        Shamsy
      </text>
      <text x="61" y="46" fontFamily="-apple-system, BlinkMacSystemFont, sans-serif" fontSize="7.5" fontWeight="700" fill="#DFE5E9" letterSpacing="2" opacity="0.85">
        SOLAR &amp; ENERGY
      </text>
    </svg>
  );
}
