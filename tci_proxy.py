"""Authenticated, same-origin WebSocket tunnel to the configured TCI server."""
import base64
import hashlib
import select
import socket
import ssl
from urllib.parse import urlsplit


def tunnel(handler, address):
    key = handler.headers.get('Sec-WebSocket-Key', '')
    try:
        if len(base64.b64decode(key, validate=True)) != 16:
            raise ValueError()
    except (ValueError, TypeError):
        handler.reply(400, {'error': 'Ongeldige WebSocket-aanvraag.'})
        return
    target = urlsplit(address)
    upstream = None
    upgraded = False
    try:
        port = target.port or (443 if target.scheme == 'wss' else 80)
        upstream = socket.create_connection((target.hostname, port), timeout=5)
        if target.scheme == 'wss':
            upstream = ssl.create_default_context().wrap_socket(upstream, server_hostname=target.hostname)
        host = target.netloc
        upstream.sendall((f'GET / HTTP/1.1\r\nHost: {host}\r\nUpgrade: websocket\r\n'
                          f'Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\n'
                          'Sec-WebSocket-Version: 13\r\n\r\n').encode('ascii'))
        header = bytearray()
        while not header.endswith(b'\r\n\r\n'):
            part = upstream.recv(1)
            if not part or len(header) >= 16384:
                raise OSError('Invalid upgrade')
            header.extend(part)
        lines = header.decode('latin1').split('\r\n')
        headers = {line.split(':',1)[0].lower():line.split(':',1)[1] for line in lines[1:] if ':' in line}
        expected = base64.b64encode(hashlib.sha1((key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').encode()).digest()).decode()
        if lines[0].split()[1] != '101' or headers.get('sec-websocket-accept', '').strip() != expected:
            raise OSError('Invalid upgrade')
        handler.send_response(101)
        handler.send_header('Upgrade', 'websocket')
        handler.send_header('Connection', 'Upgrade')
        handler.send_header('Sec-WebSocket-Accept', expected)
        handler.end_headers()
        handler.wfile.flush()
        upgraded = True
        upstream.settimeout(10)
        handler.connection.settimeout(10)
        peers = [upstream, handler.connection]
        while True:
            ready, _, _ = select.select(peers, [], [], 30)
            if isinstance(upstream, ssl.SSLSocket) and upstream.pending():
                ready = list(set(ready + [upstream]))
            for source in ready:
                data = source.recv(65536)
                if not data:
                    return
                destination = handler.connection if source is upstream else upstream
                destination.sendall(data)
    except (OSError, ValueError, IndexError):
        if not upgraded:
            handler.reply(502, {'error': 'De TCI-server op de Mac is niet bereikbaar.'})
    finally:
        handler.close_connection = True
        if upstream:
            upstream.close()
