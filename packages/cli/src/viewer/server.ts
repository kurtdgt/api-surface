/**
 * Local web server for viewing scan results
 */

import * as http from 'http';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as url from 'url';
import { open } from 'open';

export interface ServerOptions {
  port?: number;
  scanFilePath: string;
  openBrowser?: boolean;
}

/**
 * Start local web server for viewing scan results
 */
export async function startViewerServer(options: ServerOptions): Promise<void> {
  const port = options.port || 3000;
  const scanFilePath = path.resolve(options.scanFilePath);

  // Verify scan file exists
  try {
    await fs.access(scanFilePath);
  } catch {
    throw new Error(`Scan file not found: ${scanFilePath}`);
  }

  const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url || '/', true);
    const pathname = parsedUrl.pathname;

    try {
      if (pathname === '/' || pathname === '/index.html') {
        // Serve HTML viewer
        const html = await getViewerHTML();
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
      } else if (pathname === '/api/scan-result') {
        // Serve scan result JSON
        const content = await fs.readFile(scanFilePath, 'utf-8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(content);
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
      }
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(`Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  return new Promise((resolve, reject) => {
    server.listen(port, async () => {
      const url = `http://localhost:${port}`;
      console.log(`\n✓ Viewer started at ${url}`);
      console.log(`  Scan file: ${scanFilePath}`);

      if (options.openBrowser !== false) {
        try {
          await open(url);
          console.log(`  Opened in browser`);
        } catch (error) {
          console.log(`  Could not open browser automatically`);
        }
      }

      console.log(`\n  Press Ctrl+C to stop the server\n`);

      // Handle shutdown
      process.on('SIGINT', () => {
        console.log('\n\nShutting down server...');
        server.close(() => {
          console.log('Server stopped.');
          process.exit(0);
        });
      });

      resolve();
    });

    server.on('error', (error) => {
      reject(error);
    });
  });
}

/**
 * Get viewer HTML
 */
async function getViewerHTML(): Promise<string> {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>API Surface Viewer</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      background: #f5f5f5;
      color: #333;
      line-height: 1.6;
    }

    .container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 20px;
    }

    header {
      background: white;
      padding: 20px;
      border-radius: 8px;
      margin-bottom: 20px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }

    h1 {
      font-size: 24px;
      margin-bottom: 10px;
    }

    .stats {
      display: flex;
      gap: 20px;
      margin-top: 15px;
      flex-wrap: wrap;
    }

    .stat {
      padding: 10px 15px;
      background: #f8f9fa;
      border-radius: 4px;
      font-size: 14px;
    }

    .stat strong {
      display: block;
      font-size: 20px;
      color: #0066cc;
    }

    .endpoints {
      background: white;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      overflow: hidden;
    }

    .endpoint {
      border-bottom: 1px solid #e0e0e0;
      padding: 20px;
      transition: background 0.2s;
    }

    .endpoint:hover {
      background: #f8f9fa;
    }

    .endpoint:last-child {
      border-bottom: none;
    }

    .endpoint-header {
      display: flex;
      align-items: center;
      gap: 15px;
      margin-bottom: 15px;
    }

    .method {
      padding: 4px 12px;
      border-radius: 4px;
      font-weight: 600;
      font-size: 12px;
      text-transform: uppercase;
    }

    .method.get { background: #e3f2fd; color: #1976d2; }
    .method.post { background: #e8f5e9; color: #388e3c; }
    .method.put { background: #fff3e0; color: #f57c00; }
    .method.delete { background: #ffebee; color: #d32f2f; }
    .method.patch { background: #f3e5f5; color: #7b1fa2; }

    .url {
      font-family: 'Monaco', 'Courier New', monospace;
      font-size: 16px;
      flex: 1;
    }

    .confidence {
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
    }

    .confidence.high { background: #e8f5e9; color: #2e7d32; }
    .confidence.medium { background: #fff3e0; color: #ef6c00; }
    .confidence.low { background: #ffebee; color: #c62828; }

    .call-sites {
      margin-top: 15px;
      padding-top: 15px;
      border-top: 1px solid #e0e0e0;
    }

    .call-site {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px;
      background: #f8f9fa;
      border-radius: 4px;
      margin-bottom: 8px;
      font-size: 13px;
    }

    .call-site:last-child {
      margin-bottom: 0;
    }

    .file-path {
      font-family: 'Monaco', 'Courier New', monospace;
      color: #666;
      flex: 1;
    }

    .line-info {
      color: #999;
      font-size: 12px;
    }

    .loading {
      text-align: center;
      padding: 40px;
      color: #666;
    }

    .error {
      background: #ffebee;
      color: #c62828;
      padding: 20px;
      border-radius: 8px;
      margin: 20px 0;
    }
  </style>
</head>
<body>
  <div class="container">
    <div id="app">
      <div class="loading">Loading scan results...</div>
    </div>
  </div>

  <script>
    async function loadResults() {
      try {
        const response = await fetch('/api/scan-result');
        if (!response.ok) {
          throw new Error('Failed to load scan results');
        }
        const data = await response.json();
        renderResults(data);
      } catch (error) {
        document.getElementById('app').innerHTML = 
          '<div class="error">Error loading results: ' + error.message + '</div>';
      }
    }

    function renderResults(data) {
      const app = document.getElementById('app');
      
      // Calculate stats
      const summary = data.summary || {};
      const endpoints = data.endpoints || [];
      
      let html = '<header>';
      html += '<h1>API Surface Viewer</h1>';
      html += '<div class="stats">';
      html += '<div class="stat"><strong>' + (summary.totalCalls || 0) + '</strong>Total Calls</div>';
      html += '<div class="stat"><strong>' + (summary.uniqueEndpoints || 0) + '</strong>Unique Endpoints</div>';
      html += '<div class="stat"><strong>' + (summary.filesScanned || 0) + '</strong>Files Scanned</div>';
      if (summary.errors > 0) {
        html += '<div class="stat"><strong>' + summary.errors + '</strong>Errors</div>';
      }
      html += '</div>';
      html += '</header>';

      html += '<div class="endpoints">';
      
      if (endpoints.length === 0) {
        html += '<div class="endpoint"><p>No endpoints found.</p></div>';
      } else {
        endpoints.forEach(endpoint => {
          html += '<div class="endpoint">';
          html += '<div class="endpoint-header">';
          html += '<span class="method ' + endpoint.method.toLowerCase() + '">' + endpoint.method + '</span>';
          html += '<span class="url">' + escapeHtml(endpoint.url) + '</span>';
          html += '<span class="confidence ' + endpoint.confidence + '">' + endpoint.confidence + '</span>';
          html += '</div>';
          
          if (endpoint.callSites && endpoint.callSites.length > 0) {
            html += '<div class="call-sites">';
            html += '<strong style="font-size: 12px; color: #666;">Call Sites (' + endpoint.callCount + '):</strong>';
            endpoint.callSites.forEach(site => {
              html += '<div class="call-site">';
              html += '<span class="file-path">' + escapeHtml(site.file) + '</span>';
              html += '<span class="line-info">Line ' + site.line + ', Col ' + site.column + '</span>';
              if (site.confidence) {
                html += '<span class="confidence ' + site.confidence + '">' + site.confidence + '</span>';
              }
              html += '</div>';
            });
            html += '</div>';
          }
          
          html += '</div>';
        });
      }
      
      html += '</div>';
      app.innerHTML = html;
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    // Load results on page load
    loadResults();
  </script>
</body>
</html>`;
}
