-- CreateTable
CREATE TABLE "WeatherObservation" (
    "id" BIGSERIAL NOT NULL,
    "stationCode" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "precipitation10m" DOUBLE PRECISION,
    "precipitation1h" DOUBLE PRECISION,
    "temperature" DOUBLE PRECISION,
    "humidity" DOUBLE PRECISION,
    "rawJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeatherObservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WeatherObservation_stationCode_observedAt_idx" ON "WeatherObservation"("stationCode", "observedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WeatherObservation_stationCode_observedAt_key" ON "WeatherObservation"("stationCode", "observedAt");

-- AddForeignKey
ALTER TABLE "WeatherObservation" ADD CONSTRAINT "WeatherObservation_stationCode_fkey" FOREIGN KEY ("stationCode") REFERENCES "WeatherStation"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

