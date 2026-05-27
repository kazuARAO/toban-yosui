"use client";

import dynamic from "next/dynamic";
import type { DailyAggregate } from "@/lib/dam-data";

const Inner = dynamic(
  () => import("./DailySummaryChart").then((m) => m.DailySummaryChart),
  {
    ssr: false,
    loading: () => (
      <div style={{ width: "100%", height: 280 }} className="bg-gray-50 rounded animate-pulse" />
    ),
  },
);

export function DailySummaryChartClient(props: {
  data: DailyAggregate[];
  damName: string;
  fullLvl: number | null;
}) {
  return <Inner {...props} />;
}
