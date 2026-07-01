/**
 * Index a parsed datasheet PDF into the Cognee knowledge graph.
 *
 * TODO: Replace with real Cognee integration.
 * Cognee should:
 * - Parse the PDF and extract text, tables, and diagrams
 * - Identify component name, pinout, electrical characteristics
 * - Store structured knowledge nodes (component → pin → voltage, protocol)
 * - Build edges representing electrical compatibility relationships
 *
 * @returns Extracted configuration to be stored in Datasheet.cogneeConfig
 */
export async function indexDatasheet(
  _filePath: string,
  _name: string,
): Promise<Record<string, unknown>> {
  throw new Error('COGNEE_NOT_CONFIGURED');
}

/**
 * Query the Cognee knowledge graph for component-specific information.
 *
 * TODO: Replace with real Cognee integration.
 * Cognee should:
 * - Accept a natural-language or structured query
 * - Traverse the knowledge graph of indexed datasheets
 * - Return relevant specs: pin voltages, protocols, constraints
 *
 * @param query  Natural-language query (e.g. "ESP32 I2C SDA voltage")
 * @returns      Relevant extracted knowledge as a plain-text summary
 */
export async function queryComponentKnowledge(_query: string): Promise<string> {
  throw new Error('COGNEE_NOT_CONFIGURED');
}
