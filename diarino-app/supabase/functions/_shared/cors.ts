// @ts-nocheck
export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS, PUT, DELETE",
};

function addCorsHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  Object.entries(corsHeaders).forEach(([name, value]) => headers.set(name, value));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// توحيد CORS لمعالجة طلبات OPTIONS وكافة الاستجابات فوراً
export function serveWithCors(
  handler: (request: Request) => Promise<Response> | Response,
): Deno.HttpServer {
  return Deno.serve(async (request) => {
    // الاستجابة الفورية لطلبات Preflight OPTIONS
    if (request.method === "OPTIONS") {
      return new Response("ok", { status: 200, headers: corsHeaders });
    }

    try {
      const res = await handler(request);
      return addCorsHeaders(res);
    } catch (error: unknown) {
      console.error("Unhandled Edge Function error:", error);
      return new Response(JSON.stringify({ error: "Internal server error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  });
}