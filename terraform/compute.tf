data "aws_ami" "al2023" {
  most_recent = true
  owners      = ["amazon"]
  filter {
    name   = "name"
    values = ["al2023-ami-*-x86_64"]
  }
}

# Upload the app source to S3 so user_data can pull it on boot.
# Re-run `terraform apply` after editing app/*.js to push updates,
# then terminate+relaunch instances (or use the ASG refresh) to pick them up.
resource "aws_s3_object" "app_package_json" {
  bucket = aws_s3_bucket.cards.id
  key    = "app/package.json"
  source = "${path.module}/../app/package.json"
  etag   = filemd5("${path.module}/../app/package.json")
}

resource "aws_s3_object" "app_github_js" {
  bucket = aws_s3_bucket.cards.id
  key    = "app/github.js"
  source = "${path.module}/../app/github.js"
  etag   = filemd5("${path.module}/../app/github.js")
}

resource "aws_s3_object" "app_render_js" {
  bucket = aws_s3_bucket.cards.id
  key    = "app/render.js"
  source = "${path.module}/../app/render.js"
  etag   = filemd5("${path.module}/../app/render.js")
}

resource "aws_s3_object" "app_server_js" {
  bucket = aws_s3_bucket.cards.id
  key    = "app/server.js"
  source = "${path.module}/../app/server.js"
  etag   = filemd5("${path.module}/../app/server.js")
}

locals {
  user_data = templatefile("${path.module}/user_data.sh.tpl", {
    aws_region   = var.aws_region
    s3_bucket    = aws_s3_bucket.cards.id
    github_token = var.github_token
  })
}

resource "aws_instance" "app" {
  count                       = 1 # single instance: stays inside the 750 free-tier hours
  ami                         = data.aws_ami.al2023.id
  instance_type               = var.instance_type
  subnet_id                   = aws_subnet.public[0].id
  vpc_security_group_ids      = [aws_security_group.ec2.id]
  iam_instance_profile        = aws_iam_instance_profile.ec2.name
  associate_public_ip_address = true
  user_data                   = local.user_data
  user_data_replace_on_change = true

  depends_on = [
    aws_s3_object.app_package_json,
    aws_s3_object.app_github_js,
    aws_s3_object.app_render_js,
    aws_s3_object.app_server_js,
  ]

  tags = { Name = "${var.project_name}-app" }
}

resource "aws_lb" "main" {
  name               = "${var.project_name}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = aws_subnet.public[*].id
}

resource "aws_lb_target_group" "app" {
  name        = "${var.project_name}-tg"
  port        = 8080
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "instance"

  health_check {
    path                = "/healthz"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 15
    timeout             = 5
  }
}

resource "aws_lb_target_group_attachment" "app" {
  count            = length(aws_instance.app)
  target_group_arn = aws_lb_target_group.app.arn
  target_id        = aws_instance.app[count.index].id
  port             = 8080
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app.arn
  }
}

output "alb_dns_name" {
  value       = aws_lb.main.dns_name
  description = "Hit this with /stats?username=<github-user>"
}

output "s3_bucket_name" {
  value = aws_s3_bucket.cards.id
}
