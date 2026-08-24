#!/bin/bash
# ============================================================
# Instala o systemd service e o nginx do sgp.kayque.site, e
# transforma o bpa.kayque.site num redirect 301 pro novo domínio.
#
# Uso: sudo bash finish.sh
# ============================================================
set -e

if [ "$EUID" -ne 0 ]; then
  echo "Rode com sudo: sudo bash finish.sh"
  exit 1
fi

SRC="/home/kayquedev/deploy/sgp.kayque.site"

echo ">>> systemd service..."
cp "$SRC/sgp.kayque.site.service" /etc/systemd/system/sgp.kayque.site.service
systemctl daemon-reload
systemctl enable --now sgp.kayque.site.service

echo ">>> nginx sgp.kayque.site..."
cp "$SRC/nginx-sgp.conf" /etc/nginx/sites-available/sgp.kayque.site
ln -sf /etc/nginx/sites-available/sgp.kayque.site /etc/nginx/sites-enabled/sgp.kayque.site

if [ -f /etc/nginx/sites-available/bpa.kayque.site ]; then
  echo ">>> redirecionando bpa.kayque.site -> sgp.kayque.site..."
  cp /etc/nginx/sites-available/bpa.kayque.site /etc/nginx/sites-available/bpa.kayque.site.bak
  cat > /etc/nginx/sites-available/bpa.kayque.site <<'EOF'
server {
    server_name bpa.kayque.site;

    location / {
        return 301 https://sgp.kayque.site$request_uri;
    }

    listen 443 ssl; # managed by Certbot
    ssl_certificate /etc/letsencrypt/live/bpa.kayque.site/fullchain.pem; # managed by Certbot
    ssl_certificate_key /etc/letsencrypt/live/bpa.kayque.site/privkey.pem; # managed by Certbot
    include /etc/letsencrypt/options-ssl-nginx.conf; # managed by Certbot
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem; # managed by Certbot

}
server {
    if ($host = bpa.kayque.site) {
        return 301 https://$host$request_uri;
    } # managed by Certbot


    server_name bpa.kayque.site;

    listen 80;
    return 404; # managed by Certbot


}
EOF
fi

nginx -t
systemctl reload nginx

echo
echo "============================================================"
echo "OK. http://sgp.kayque.site no ar (proxy pra 127.0.0.1:4000)."
echo "Falta o HTTPS, rode:"
echo "  sudo certbot --nginx -d sgp.kayque.site"
echo "============================================================"
