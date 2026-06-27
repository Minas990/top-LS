resource "aws_s3_bucket" "cards" {
  bucket_prefix = "${var.project_name}-cards-"
  force_destroy = true # lets terraform destroy clean up test objects
}

resource "aws_s3_bucket_public_access_block" "cards" {
  bucket                  = aws_s3_bucket.cards.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "cards" {
  bucket = aws_s3_bucket.cards.id
  rule {
    id     = "expire-cards-after-1-day"
    status = "Enabled"
    filter { prefix = "cards/" }
    expiration { days = 1 }
  }
}
