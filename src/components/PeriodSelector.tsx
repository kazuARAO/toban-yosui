import { PERIOD_PRESETS, type PeriodKey } from "@/lib/period";

type Props = {
  current: PeriodKey;
  from?: string;
  to?: string;
};

export function PeriodSelector({ current, from, to }: Props) {
  const buildHref = (key: PeriodKey): string => {
    if (key === "custom") {
      const p = new URLSearchParams();
      p.set("period", "custom");
      if (from) p.set("from", from);
      if (to) p.set("to", to);
      return `/?${p.toString()}`;
    }
    return `/?period=${key}`;
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {PERIOD_PRESETS.map(({ key, label }) => (
        <a
          key={key}
          href={buildHref(key)}
          className={`px-3 py-1.5 rounded-md text-sm border ${
            current === key
              ? "bg-blue-600 text-white border-blue-600"
              : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
          }`}
        >
          {label}
        </a>
      ))}
      {current === "custom" && (
        <form action="/" method="get" className="flex items-center gap-2 ml-2 flex-wrap">
          <input type="hidden" name="period" value="custom" />
          <input
            type="date"
            name="from"
            defaultValue={from ?? ""}
            className="border rounded px-2 py-1 text-sm"
            required
          />
          <span className="text-gray-500 text-sm">〜</span>
          <input
            type="date"
            name="to"
            defaultValue={to ?? ""}
            className="border rounded px-2 py-1 text-sm"
            required
          />
          <button
            type="submit"
            className="px-3 py-1.5 rounded-md text-sm bg-gray-800 text-white hover:bg-gray-700"
          >
            適用
          </button>
        </form>
      )}
    </div>
  );
}
