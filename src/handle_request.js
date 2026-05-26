import { handleVerification } from './verify_keys.js';
import openai from './openai.mjs';

/**
 * Extract and load-balance API keys from either x-goog-api-key or Authorization: Bearer header.
 * Returns { key, headerName } where headerName indicates which header the key came from.
 */
function selectApiKey(request) {
  // Try x-goog-api-key first
  const xKey = request.headers.get('x-goog-api-key');
  if (xKey) {
    const keys = xKey.split(',').map(k => k.trim()).filter(k => k);
    if (keys.length > 0) {
      const selected = keys[Math.floor(Math.random() * keys.length)];
      return { key: selected, headerName: 'x-goog-api-key' };
    }
  }

  // Fallback to Authorization: Bearer
  const auth = request.headers.get('Authorization');
  if (auth?.startsWith('Bearer ')) {
    const token = auth.slice(7);
    const keys = token.split(',').map(k => k.trim()).filter(k => k);
    if (keys.length > 0) {
      const selected = keys[Math.floor(Math.random() * keys.length)];
      return { key: selected, headerName: 'Authorization' };
    }
  }

  return null;
}

/** OpenAI-compatible endpoint paths (supports both /v1/... and bare paths) */
const OPENAI_PATHS = [
  '/chat/completions',
  '/v1/chat/completions',
  '/embeddings',
  '/v1/embeddings',
  '/models',
  '/v1/models',
  '/completions',
  '/v1/completions',
];

function isOpenAIPath(pathname) {
  return OPENAI_PATHS.some(p => pathname.endsWith(p));
}

export async function handleRequest(request) {

  const url = new URL(request.url);
  const pathname = url.pathname;
  const search = url.search;

  // 根路径健康检查
  if (pathname === '/' || pathname === '/index.html') {
    return new Response('Proxy is Running!  More Details: https://github.com/asd147/gemini-balance-lite', {
      status: 200,
      headers: { 'Content-Type': 'text/html' }
    });
  }

  // API Key 校验
  if (pathname === '/verify' && request.method === 'POST') {
    return handleVerification(request);
  }

  // OpenAI 兼容格式请求
  if (isOpenAIPath(pathname)) {
    return openai.fetch(request);
  }

  // Gemini 原生 API 代理
  const targetUrl = `https://generativelanguage.googleapis.com${pathname}${search}`;

  try {
    const headers = new Headers();
    for (const [key, value] of request.headers.entries()) {
      const lowerKey = key.trim().toLowerCase();
      if (lowerKey === 'x-goog-api-key') {
        const apiKey = selectApiKey(request);
        if (apiKey) {
          console.log(`Gemini Selected API Key: ${apiKey.key}`);
          headers.set('x-goog-api-key', apiKey.key);
        }
      } else if (lowerKey === 'content-type') {
        headers.set(key, value);
      }
      // 其他头部不转发
    }

    console.log('Request Sending to Gemini');
    console.log('targetUrl:' + targetUrl);

    const response = await fetch(targetUrl, {
      method: request.method,
      headers: headers,
      body: request.body
    });

    console.log("Call Gemini Success");

    const responseHeaders = new Headers(response.headers);

    responseHeaders.delete('transfer-encoding');
    responseHeaders.delete('connection');
    responseHeaders.delete('keep-alive');
    responseHeaders.delete('content-encoding');
    responseHeaders.set('Referrer-Policy', 'no-referrer');

    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders
    });

  } catch (error) {
   console.error('Failed to fetch:', error);
   return new Response('Internal Server Error\n' + error?.stack, {
    status: 500,
    headers: { 'Content-Type': 'text/plain' }
   });
  }
};
