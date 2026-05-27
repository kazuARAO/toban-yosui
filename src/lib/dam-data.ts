import { prisma } from "./prisma";

export type DamSummary = {
  id: number;
  code: string;
  name: string;
  river: string | null;
  address: string | null;
  totalCapacity: number | null;
  nrmlHighStg: number | null;
};

export type ObservationPoint = {
  observedAt: string; // ISO string
  storLvl: number | null;
  allSink: number | null;
  allDisch: number | null;
};

export type DailyReportPoint = {
  reportDate: string; // YYYY-MM-DD
  storCap: number | null;
  storPcntIrr: number | null;
};

export type DamPayload = {
  dam: DamSummary;
  observations: ObservationPoint[];
  dailyReports: DailyReportPoint[];
};

export async function getDamsWithSeries(
  hoursBack = 24 * 7,
): Promise<DamPayload[]> {
  const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000);
  const dams = await prisma.dam.findMany({ orderBy: { id: "asc" } });

  const result: DamPayload[] = [];
  for (const d of dams) {
    const obs = await prisma.observation.findMany({
      where: { damId: d.id, source: "kawabou", observedAt: { gte: since } },
      orderBy: { observedAt: "asc" },
      select: {
        observedAt: true,
        storLvl: true,
        allSink: true,
        allDisch: true,
      },
    });
    const reports = await prisma.dailyReport.findMany({
      where: { damId: d.id },
      orderBy: { reportDate: "desc" },
      take: 14,
      select: { reportDate: true, storCap: true, storPcntIrr: true },
    });
    result.push({
      dam: {
        id: d.id,
        code: d.code,
        name: d.name,
        river: d.river,
        address: d.address,
        totalCapacity: d.totalCapacity,
        nrmlHighStg: d.nrmlHighStg,
      },
      observations: obs.map((o) => ({
        observedAt: o.observedAt.toISOString(),
        storLvl: o.storLvl,
        allSink: o.allSink,
        allDisch: o.allDisch,
      })),
      dailyReports: reports
        .map((r) => ({
          reportDate: r.reportDate.toISOString().slice(0, 10),
          storCap: r.storCap,
          storPcntIrr: r.storPcntIrr,
        }))
        .reverse(),
    });
  }
  return result;
}
