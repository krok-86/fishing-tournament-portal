export function Podium({ champion, finalist, third, tournamentName, tournamentDate, }) {
    const dateLabel = formatCeremonyDate(tournamentDate);
    return (<section className="relative mx-auto mb-8 max-w-4xl overflow-hidden rounded-[2rem] border border-amber-200/25 bg-slate-950 px-3 py-8 shadow-2xl shadow-amber-900/20 sm:px-8 sm:py-10" aria-label="Подиум призёров">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-48 bg-[radial-gradient(ellipse_at_center,rgba(251,191,36,0.28),transparent_68%)]"/>
      <div className="relative text-center">
        <p className="text-[11px] font-bold tracking-[0.32em] text-amber-200 uppercase">Турнир завершён</p>
        {tournamentName && (<h3 className="mt-2 text-3xl font-black tracking-tight text-white sm:text-5xl">{tournamentName}</h3>)}
        {dateLabel && <p className="mt-2 text-sm font-semibold text-slate-300 sm:text-base">{dateLabel}</p>}
      </div>

      <div className="podium-stage relative mt-8">
        <div className="flex items-end justify-center gap-2 sm:gap-4">
          <Place athlete={finalist} medal="silver"/>
          <Place athlete={champion} medal="gold"/>
          <Place athlete={third} medal="bronze"/>
        </div>
        <div className="mx-auto mt-1 h-3 w-[min(100%,40rem)] rounded-b-[2rem] bg-gradient-to-b from-slate-600/80 to-slate-950 shadow-[0_18px_30px_rgba(0,0,0,0.45)]"/>
      </div>
    </section>);
}
function Place({ athlete, medal }) {
    const icon = medal === "gold" ? "🏆" : medal === "silver" ? "🥈" : "🥉";
    const place = medal === "gold" ? "1" : medal === "silver" ? "2" : "3";
    const delay = medal === "gold" ? "40ms" : medal === "silver" ? "160ms" : "280ms";
    return (<div className="podium-rise flex w-[31%] max-w-[13.5rem] flex-col items-center sm:w-52" style={{ animationDelay: delay }}>
      <div className={medal === "gold" ? "podium-trophy text-5xl sm:text-7xl" : "text-3xl sm:text-5xl"} aria-hidden="true">
        {icon}
      </div>
      <p className={medal === "gold"
            ? "mt-1 max-w-full text-center text-lg leading-tight font-black text-amber-50 sm:text-3xl"
            : "mt-1 max-w-full text-center text-sm leading-tight font-black text-white sm:text-xl"}>
        {athlete.displayName}
      </p>
      <p className="mt-1 text-[11px] font-bold tracking-wide text-slate-300 sm:text-xs">№ {athlete.bibNumber}</p>
      <p className={`mt-1 text-[10px] font-black tracking-[0.16em] uppercase sm:text-[11px] ${medal === "gold" ? "text-amber-200" : medal === "silver" ? "text-slate-200" : "text-orange-200"}`}>
        {athlete.stage}
      </p>
      <div className="podium-column mt-3 w-full">
        <div className={`podium-lip podium-lip-${medal}`}/>
        <div className={`podium-block podium-block-${medal} ${medal === "gold" ? "h-40 sm:h-56" : medal === "silver" ? "h-28 sm:h-40" : "h-20 sm:h-32"}`}>
          <span className="text-4xl font-black tabular-nums sm:text-6xl">{place}</span>
        </div>
      </div>
    </div>);
}
function formatCeremonyDate(iso) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!match)
        return iso.trim();
    return `${match[3]}.${match[2]}.${match[1]}`;
}
