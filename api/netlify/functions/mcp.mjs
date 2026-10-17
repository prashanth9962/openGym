// Netlify Function (v2): the remote MCP endpoint, /mcp/<token>. Read-only; reads the same MongoDB
// the API writes. The token is made in the app (Settings → Account); needs MONGODB_URI.
// See docs/SERVERLESS.md.
import { handleMcp } from '../../../mcp/src/remote.js';

export default req => handleMcp(req);

export const config = { path: ['/mcp', '/mcp/*'] };
