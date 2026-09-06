# Deployment

Everything is driven by GitHub Actions. No step in this document is meant to be
carried out by hand on a laptop, and no credential belongs anywhere in this
repository.

## Hosting layout

| Environment | Host | URL | Trigger |
| --- | --- | --- | --- |
| Staging | GitHub Pages | `https://<owner>.github.io/<repo>/` | push to `main` |
| Production | Cloudflare Pages | `https://skills.ronald.ng` | `v*` tag or manual run |

Staging serves `robots.txt` with `Disallow: /` so it cannot compete with
production in search results. Production serves a `sitemap.xml` and allows
indexing.

## An important correction about DNS

`ronald.ng` **is not on Cloudflare.** Its authoritative nameservers are AWS Route 53:

```
$ dig +short NS ronald.ng
ns-1173.awsdns-18.org.
ns-1548.awsdns-01.co.uk.
ns-381.awsdns-47.com.
ns-549.awsdns-04.net.
```

Cloudflare is used for *hosting* the Pages project, and historically for a staging
preview of the main site, which is the likely source of the confusion. The zone
itself stays on Route 53.

This matters because it changes what a custom domain requires. Cloudflare Pages
can serve a custom domain whose DNS lives elsewhere, but the record has to be
created in Route 53 and Cloudflare validates it over that CNAME. There is no need
to migrate the zone, and migrating it would put a live business domain at risk for
no benefit.

### Records that must not be touched

These are live and unrelated to this project. `dns.yml` refuses to modify any name
other than `skills.ronald.ng`, and prints these before it does anything.

| Record | Points at | Why it matters |
| --- | --- | --- |
| `ronald.ng` | CloudFront | the main site |
| `www.ronald.ng` | CloudFront | the main site |
| `resume.ronald.ng` | CloudFront `d1srz7a0s8w38` | the résumé site |
| `mcp.ronald.ng` | API Gateway, ap-east-1 | a live service endpoint |

`skills.ronald.ng` did not exist before this project, so nothing is being taken
over.

## One-time setup

### 1. Enable GitHub Pages

Settings → Pages → Build and deployment → Source: **GitHub Actions**.

No token needed. The workflow publishes with a short-lived OIDC token that Actions
mints for the run.

### 2. Create the Cloudflare Pages project

Create a Pages project with **Direct Upload** (not a Git connection: the deploy is
driven from this repository's workflow, and connecting Git as well would give you
two competing deploy paths). Name it `skill-library`, or set the repository
variable `CLOUDFLARE_PROJECT_NAME` to whatever you call it.

Then add `skills.ronald.ng` as a custom domain on the project. Cloudflare will
show you the CNAME target and wait for it to resolve.

### 3. Add the repository secrets

Settings → Secrets and variables → Actions. These are read by reference at run
time and never written into the tree, the artifact, or the logs.

| Name | Kind | Used by | Notes |
| --- | --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | secret | `deploy-production.yml` | Scope it to **Cloudflare Pages: Edit** on this account only. Do not use a Global API Key. |
| `CLOUDFLARE_ACCOUNT_ID` | secret | `deploy-production.yml` | Not strictly confidential, kept as a secret so it never appears in the tree. |
| `AWS_ROLE_ARN` | secret | `dns.yml` | An IAM role trusted for GitHub OIDC. **No access keys.** |
| `AWS_HOSTED_ZONE_ID` | secret | `dns.yml` | The `ronald.ng` hosted zone. |
| `CLOUDFLARE_PROJECT_NAME` | variable | both | Optional; defaults to `skill-library`. |

`deploy-production.yml` fails in its first job if a required secret is missing,
rather than skipping its own deploy step and reporting green.

### 4. Create the AWS role for DNS, with no stored keys

`dns.yml` assumes a role by OIDC, so there is no AWS access key in this repository
or in its secrets. Trust policy, restricted to this repository:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Federated": "arn:aws:iam::<ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com" },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
      "StringLike": { "token.actions.githubusercontent.com:sub": "repo:<OWNER>/<REPO>:*" }
    }
  }]
}
```

Permission policy, scoped to the one zone and the one record:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "route53:ChangeResourceRecordSets",
      "Resource": "arn:aws:route53:::hostedzone/<HOSTED_ZONE_ID>",
      "Condition": {
        "ForAllValues:StringEquals": {
          "route53:ChangeResourceRecordSetsNormalizedRecordNames": ["skills.ronald.ng"],
          "route53:ChangeResourceRecordSetsRecordTypes": ["CNAME"]
        }
      }
    },
    {
      "Effect": "Allow",
      "Action": ["route53:GetChange", "route53:ListResourceRecordSets"],
      "Resource": "*"
    }
  ]
}
```

That condition is the real safety net: even if the workflow were changed to point
at the apex, AWS would refuse the call.

### 5. Protect the environments

Settings → Environments.

- `production` — require a reviewer, and restrict to `main` and `v*` tags.
- `production-dns` — require a reviewer. This one edits a live business domain.
- `staging` — no protection needed.

### 6. Point DNS at Cloudflare

Run the **DNS for skills.ronald.ng** workflow with `action: plan`. It prints the
current nameservers, the live records it will not touch, and the change it would
make. Read that output, then run it again with `action: apply`.

It waits for the change to reach `INSYNC` and then confirms the name resolves
before reporting success.

### 7. Ship

```bash
git tag v1.0.0 && git push origin v1.0.0
```

Or run **Deploy production** manually with a reason.

## What a production deploy verifies

The deploy is not considered successful because an upload succeeded. After
publishing, CI checks against the live origin that:

- the custom domain resolves, falling back to the `pages.dev` origin with a
  warning if the CNAME is not in place yet
- the served HTML contains 400+ prerendered cards
- `BUILD-INFO.txt` names the commit being deployed, so a cached previous deploy is
  detected rather than mistaken for success
- the page renders with no console or page errors at 390px and 1440px
- there is no horizontal overflow at either width
- it is still a complete list with JavaScript disabled
- `Strict-Transport-Security`, `X-Content-Type-Options` and `Referrer-Policy` are
  present on the response

Any of those failing fails the deploy.

## Rollback

Cloudflare Pages keeps every deployment. Roll back in the dashboard, or re-run
**Deploy production** from an earlier tag. Because the artifact is rebuilt from
source in CI on every run, an old tag rebuilds to what that tag actually said.

## Branch protection

Require the check named **`all gates passed`** on `main`. That is a single stable
job name that depends on the other CI jobs, so the required check does not need
changing when a job is added or renamed.
