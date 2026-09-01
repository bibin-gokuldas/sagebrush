# SAGEBRUSH — AI Architect Agent

## Setup
1. `npm install -g @servicenow/sdk`
2. `snc login --instance <your-dev-instance>`
3. `snc app push`

## Development Rules
- ES5 JavaScript only (no arrow functions, no let/const)
- All Script Includes: callable_from_other_scopes = true
- Use GSLog, never gs.print()
- No GlideRecord in Flow steps — use Script Include Action Steps
- Run ATF suite before every push to TEST: `snc atf run --suite SAGEBRUSH_ATF_Suite`

## Commands
- Push to DEV: `snc app push --instance dev.service-now.com`
- Run tests:   `snc atf run --suite SAGEBRUSH_ATF_Suite`
- Package:     `snc app package --output ./dist/sagebrush_v1.0.0.zip`
