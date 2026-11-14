# Statischer Testserver, verhält sich wie GitHub Pages: Unterordner + max-age=600
import http.server, sys, os, functools
root, port = sys.argv[1], int(sys.argv[2])
import time
class H(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if os.path.exists(os.path.join(root, '.slow')): time.sleep(9)   # langsames Netz simulieren
        try: super().do_GET()
        except (BrokenPipeError, ConnectionResetError): pass
    def end_headers(self):
        self.send_header('Cache-Control', 'max-age=600')
        super().end_headers()
    def log_message(self, *a): pass
H.extensions_map['.webmanifest'] = 'application/manifest+json'
http.server.ThreadingHTTPServer(('127.0.0.1', port), functools.partial(H, directory=root)).serve_forever()
