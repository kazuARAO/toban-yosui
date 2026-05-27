-- DropIndex
DROP INDEX "Weather_station_observedDate_key";

-- AlterTable
ALTER TABLE "Weather" DROP COLUMN "station",
ADD COLUMN     "stationCode" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "WeatherStation" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKana" TEXT,
    "prefecture" TEXT,
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,
    "type" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeatherStation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DamWeatherStation" (
    "damId" INTEGER NOT NULL,
    "stationCode" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "label" TEXT,

    CONSTRAINT "DamWeatherStation_pkey" PRIMARY KEY ("damId","stationCode")
);

-- CreateIndex
CREATE UNIQUE INDEX "WeatherStation_code_key" ON "WeatherStation"("code");

-- CreateIndex
CREATE INDEX "DamWeatherStation_damId_priority_idx" ON "DamWeatherStation"("damId", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "Weather_stationCode_observedDate_key" ON "Weather"("stationCode", "observedDate");

-- AddForeignKey
ALTER TABLE "DamWeatherStation" ADD CONSTRAINT "DamWeatherStation_damId_fkey" FOREIGN KEY ("damId") REFERENCES "Dam"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DamWeatherStation" ADD CONSTRAINT "DamWeatherStation_stationCode_fkey" FOREIGN KEY ("stationCode") REFERENCES "WeatherStation"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Weather" ADD CONSTRAINT "Weather_stationCode_fkey" FOREIGN KEY ("stationCode") REFERENCES "WeatherStation"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

