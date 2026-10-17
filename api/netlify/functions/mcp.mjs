// Netlify Function (v2): the remote MCP endpoint, /mcp/<MCP_TOKEN>. Read-only; reads the same
// MongoDB the API writes. Needs MCP_TOKEN (24+ characters) and MONGODB_URI. See docs/SERVERLESS.md.
import { handleMcp } from '../../../mcp/src/remote.js';

export default req => handleMcp(req);

export const config = { path: ['/mcp', '/mcp/*'] };
