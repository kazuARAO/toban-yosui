-- CreateTable
CREATE TABLE "Dam" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKana" TEXT,
    "riverSystem" TEXT,
    "river" TEXT,
    "address" TEXT,
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,
    "nrmlHighStg" DOUBLE PRECISION,
    "dsgnFldLv" DOUBLE PRECISION,
    "totalCapacity" DOUBLE PRECISION,
    "effectiveCapacity" DOUBLE PRECISION,
    "basinArea" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Dam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Observation" (
    "id" BIGSERIAL NOT NULL,
    "damId" INTEGER NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'kawabou',
    "storLvl" DOUBLE PRECISION,
    "allSink" DOUBLE PRECISION,
    "allDisch" DOUBLE PRECISION,
    "storCap" DOUBLE PRECISION,
    "storPcntIrr" DOUBLE PRECISION,
    "storPcntEff" DOUBLE PRECISION,
    "rawJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Observation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyReport" (
    "id" SERIAL NOT NULL,
    "damId" INTEGER NOT NULL,
    "reportDate" DATE NOT NULL,
    "storCap" DOUBLE PRECISION,
    "storPcntIrr" DOUBLE PRECISION,
    "sourceUrl" TEXT,
    "rawHtml" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Weather" (
    "id" SERIAL NOT NULL,
    "station" TEXT NOT NULL,
    "observedDate" DATE NOT NULL,
    "precipitation" DOUBLE PRECISION,
    "temperatureAvg" DOUBLE PRECISION,
    "temperatureMax" DOUBLE PRECISION,
    "temperatureMin" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Weather_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LineSubscriber" (
    "id" SERIAL NOT NULL,
    "lineUserId" TEXT NOT NULL,
    "displayName" TEXT,
    "thresholdPcnt" DOUBLE PRECISION NOT NULL DEFAULT 35.0,
    "weeklyDropPcnt" DOUBLE PRECISION NOT NULL DEFAULT 10.0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LineSubscriber_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationLog" (
    "id" SERIAL NOT NULL,
    "subscriberId" INTEGER NOT NULL,
    "damId" INTEGER,
    "trigger" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Dam_code_key" ON "Dam"("code");

-- CreateIndex
CREATE INDEX "Observation_damId_observedAt_idx" ON "Observation"("damId", "observedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Observation_damId_observedAt_source_key" ON "Observation"("damId", "observedAt", "source");

-- CreateIndex
CREATE UNIQUE INDEX "DailyReport_damId_reportDate_key" ON "DailyReport"("damId", "reportDate");

-- CreateIndex
CREATE UNIQUE INDEX "Weather_station_observedDate_key" ON "Weather"("station", "observedDate");

-- CreateIndex
CREATE UNIQUE INDEX "LineSubscriber_lineUserId_key" ON "LineSubscriber"("lineUserId");

-- CreateIndex
CREATE INDEX "NotificationLog_subscriberId_sentAt_idx" ON "NotificationLog"("subscriberId", "sentAt");

-- AddForeignKey
ALTER TABLE "Observation" ADD CONSTRAINT "Observation_damId_fkey" FOREIGN KEY ("damId") REFERENCES "Dam"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyReport" ADD CONSTRAINT "DailyReport_damId_fkey" FOREIGN KEY ("damId") REFERENCES "Dam"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_subscriberId_fkey" FOREIGN KEY ("subscriberId") REFERENCES "LineSubscriber"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
