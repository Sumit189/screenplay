/**
 * API endpoint to get the client's IP address
 */
module.exports = (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Handle OPTIONS request (CORS preflight)
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  let ip;
  
  // Try to get IP from various headers
  if (req.headers['x-forwarded-for']) {
    // Get the client IP from the 'x-forwarded-for' header
    // This is commonly set by proxies, including Vercel's
    ip = req.headers['x-forwarded-for'].split(',')[0].trim();
  } else if (req.headers['x-real-ip']) {
    // Fallback to 'x-real-ip'
    ip = req.headers['x-real-ip'];
  } else if (req.socket && req.socket.remoteAddress) {
    // Last resort, use socket's remote address
    ip = req.socket.remoteAddress;
  } else {
    // If we can't determine the IP
    ip = '127.0.0.1';
  }
  
  // Clean the IP (remove IPv6 prefix if present)
  if (ip.includes('::ffff:')) {
    ip = ip.replace('::ffff:', '');
  }
  
  // Return the IP to the client
  res.json({ ip });
}; 