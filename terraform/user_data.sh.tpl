#!/bin/bash
set -euxo pipefail

dnf update -y
dnf install -y nodejs npm

mkdir -p /opt/app
aws s3 cp "s3://${s3_bucket}/app/" /opt/app/ --recursive --region "${aws_region}"

cd /opt/app
npm install --omit=dev --no-audit --no-fund

cat > /etc/systemd/system/github-stats.service <<UNIT_EOF
[Unit]
Description=github-stats app
After=network.target

[Service]
Environment=PORT=8080
Environment=AWS_REGION=${aws_region}
Environment=S3_BUCKET=${s3_bucket}
Environment=GITHUB_TOKEN=${github_token}
WorkingDirectory=/opt/app
ExecStart=/usr/bin/node /opt/app/server.js
Restart=always
RestartSec=3
User=ec2-user

[Install]
WantedBy=multi-user.target
UNIT_EOF

systemctl daemon-reload
systemctl enable github-stats
systemctl start github-stats
