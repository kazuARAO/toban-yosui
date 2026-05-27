"use client";

import dynamic from "next/dynamic";
import type { ObservationPoint } from "@/lib/dam-data";

const DamChartInner = dynamic(
  () => import("./DamChart").then((m) => m.DamChart),
  {
    ssr: false,
    loading: () => (
      <div style={{ width: "100%", height: 288 }} className="bg-gray-50 rounded animate-pulse" />
    ),
  },
);

export function DamChartClient(props: {
  data: ObservationPoint[];
  damName: string;
  fullLvl: number | null;
}) {
  return <DamChartInner {...props} />;
}
