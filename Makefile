.PHONY: help dev build start db-up db-down db-reset db-shell migrate seed scrape-kawabou scrape-toban scrape-weather lint format clean

help:
	@echo "Available commands:"
	@echo "  make dev             - Run Next.js dev server"
	@echo "  make build           - Build Next.js"
	@echo "  make start           - Start Next.js production server"
	@echo "  make db-up           - Start PostgreSQL via Docker"
	@echo "  make db-down         - Stop PostgreSQL"
	@echo "  make db-reset        - Reset DB (drop volume + re-migrate)"
	@echo "  make db-shell        - psql shell"
	@echo "  make migrate         - Run Prisma migrate dev"
	@echo "  make seed            - Seed dams (大川瀬 + 呑吐)"
	@echo "  make scrape-kawabou  - Fetch kawabou JSON (10min observations)"
	@echo "  make scrape-toban    - Fetch toban-yosui.jp daily report"
	@echo "  make scrape-weather  - Fetch JMA daily weather"

dev:
	pnpm dev

build:
	NODE_ENV=production pnpm build

start:
	pnpm start

db-up:
	docker compose up -d
	@echo "Waiting for DB to be healthy..."
	@until docker compose exec -T db pg_isready -U toban -d toban_yosui >/dev/null 2>&1; do sleep 1; done
	@echo "DB ready."

db-down:
	docker compose down

db-reset:
	docker compose down -v
	$(MAKE) db-up
	$(MAKE) migrate
	$(MAKE) seed

db-shell:
	docker compose exec db psql -U toban -d toban_yosui

migrate:
	pnpm exec prisma migrate dev

seed:
	cd scrapers && uv run python -m toban_scraper.seed

scrape-kawabou:
	cd scrapers && uv run python -m toban_scraper.kawabou

scrape-toban:
	cd scrapers && uv run python -m toban_scraper.toban

scrape-weather:
	cd scrapers && uv run python -m toban_scraper.weather

lint:
	pnpm lint

clean:
	rm -rf .next node_modules
