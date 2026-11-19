// Loaded first (node --import) so auto-instrumentation can patch http/express/pg/mongodb.
import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";

if (process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT) {
  const sdk = new NodeSDK({ serviceName: "atlasone-api", traceExporter: new OTLPTraceExporter(),
    instrumentations: [getNodeAutoInstrumentations({ "@opentelemetry/instrumentation-fs": { enabled: false } })] });
  sdk.start();
  process.on("SIGTERM", () => sdk.shutdown());
}
