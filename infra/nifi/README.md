# NiFi flows

## 1. Subsidiary financials (CSV → AtlasOne)
1. **GetFile**: Input Directory `/opt/nifi/input`, File Filter `.*\.csv`
2. **ConvertRecord**: Record Reader `CSVReader` (header = true), Record Writer `JsonRecordSetWriter` (output as an array)
3. **InvokeHTTP**: Method `POST`, URL `http://host.docker.internal:4000/api/ingest/financials`
   (or `http://api:4000/...` with `--profile app`), dynamic property `x-api-key = nifi-dev-key`, Content-Type `application/json`
4. Route `Response` (2xx) → **LogAttribute**. Route `Failure`/`Retry` → **PutFile** `/opt/nifi/input/failed`

Drop `financials-sample.csv` into `infra/nifi/input/` and the rows appear on the CEO dashboard within the 60 s cache window.

## 2. Daily FX rates
**GenerateFlowFile** (CRON `0 0 6 * * ?`) → **InvokeHTTP** GET from your FX provider → **JoltTransformJSON** to `{ "EUR": 1.08, "PKR": 0.0036, ... }` → **InvokeHTTP** POST `/api/ingest/fx-rates` with the same API key.

The API records every ingest batch in the audit log as `FINANCIALS_INGESTED`, with inserted and error counts.
