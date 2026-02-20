import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  // Skip auth check if Supabase is not configured yet
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const keyLooksValid = supabaseKey?.startsWith('eyJ') || supabaseKey?.startsWith('sb_');
  if (
    !supabaseUrl ||
    !supabaseKey ||
    supabaseUrl === 'your-project-url-here' ||
    supabaseKey === 'your-anon-key-here' ||
    !keyLooksValid
  ) {
    // Auth not configured — let everything through
    return NextResponse.next();
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        );
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Protected routes: camera, saved, gallery require login
  const protectedPaths = ['/camera', '/saved', '/gallery'];
  const isProtected = protectedPaths.some((p) =>
    request.nextUrl.pathname.startsWith(p)
  );

  if (isProtected && !user) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set(
      'next',
      request.nextUrl.pathname + request.nextUrl.search
    );
    return NextResponse.redirect(url);
  }

  // If logged in and visiting /login, redirect to browse
  if (user && request.nextUrl.pathname === '/login') {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: ['/camera/:path*', '/saved/:path*', '/login'],
};
