// Netlify Function (v2): the remote MCP endpoint, /mcp/<token>. Reads the same MongoDB the API
// writes, and changes the profile through the API. The token is made in the app (Settings → Account); needs MONGODB_URI.
// See docs/SERVERLESS.md.
import { handleMcp } from '../../../mcp/src/remote.js';

export default req => handleMcp(req);

export const config = { path: ['/mcp', '/mcp/*'] };
