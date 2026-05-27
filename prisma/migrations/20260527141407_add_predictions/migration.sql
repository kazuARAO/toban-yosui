-- CreateTable
CREATE TABLE "JmaForecast" (
    "id" SERIAL NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "areaCode" TEXT NOT NULL,
    "targetDate" DATE NOT NULL,
    "precipitation" DOUBLE PRECISION,
    "precipProb" DOUBLE PRECISION,
    "tempMax" DOUBLE PRECISION,
    "tempMin" DOUBLE PRECISION,
    "weatherText" TEXT,
    "rawJson" JSONB,

    CONSTRAINT "JmaForecast_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PredictionRun" (
    "id" SERIAL NOT NULL,
    "damId" INTEGER NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "baseStorPcnt" DOUBLE PRECISION NOT NULL,
    "baseStorLvl" DOUBLE PRECISION,
    "baseObservedAt" TIMESTAMP(3) NOT NULL,
    "recentDays" INTEGER NOT NULL,
    "recentDropRate" DOUBLE PRECISION,
    "contextJson" JSONB,

    CONSTRAINT "PredictionRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeterministicForecast" (
    "id" SERIAL NOT NULL,
    "runId" INTEGER NOT NULL,
    "optimistic7d" DOUBLE PRECISION,
    "standard7d" DOUBLE PRECISION,
    "pessimistic7d" DOUBLE PRECISION,
    "optimistic30d" DOUBLE PRECISION,
    "standard30d" DOUBLE PRECISION,
    "pessimistic30d" DOUBLE PRECISION,
    "daysTo30pct" INTEGER,
    "actual7d" DOUBLE PRECISION,
    "actual30d" DOUBLE PRECISION,
    "evaluatedAt" TIMESTAMP(3),

    CONSTRAINT "DeterministicForecast_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LLMForecast" (
    "id" SERIAL NOT NULL,
    "runId" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "predicted7d" DOUBLE PRECISION,
    "predicted30d" DOUBLE PRECISION,
    "warningLevel" TEXT,
    "reasoning" TEXT,
    "promptInput" JSONB,
    "rawResponse" TEXT,
    "generationMs" INTEGER,
    "errorMessage" TEXT,
    "actual7d" DOUBLE PRECISION,
    "actual30d" DOUBLE PRECISION,
    "error7d" DOUBLE PRECISION,
    "error30d" DOUBLE PRECISION,
    "evaluatedAt" TIMESTAMP(3),
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LLMForecast_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JmaForecast_areaCode_targetDate_idx" ON "JmaForecast"("areaCode", "targetDate");

-- CreateIndex
CREATE UNIQUE INDEX "JmaForecast_areaCode_targetDate_fetchedAt_key" ON "JmaForecast"("areaCode", "targetDate", "fetchedAt");

-- CreateIndex
CREATE INDEX "PredictionRun_damId_generatedAt_idx" ON "PredictionRun"("damId", "generatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DeterministicForecast_runId_key" ON "DeterministicForecast"("runId");

-- CreateIndex
CREATE INDEX "LLMForecast_runId_provider_idx" ON "LLMForecast"("runId", "provider");

-- AddForeignKey
ALTER TABLE "PredictionRun" ADD CONSTRAINT "PredictionRun_damId_fkey" FOREIGN KEY ("damId") REFERENCES "Dam"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeterministicForecast" ADD CONSTRAINT "DeterministicForecast_runId_fkey" FOREIGN KEY ("runId") REFERENCES "PredictionRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LLMForecast" ADD CONSTRAINT "LLMForecast_runId_fkey" FOREIGN KEY ("runId") REFERENCES "PredictionRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

