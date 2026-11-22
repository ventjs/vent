#!/usr/bin/env bun

import { generateGraphqlModule } from './generators/graphql-module.generator'
import { restGenerateModule } from './generators/rest-module.generator'
import { detectProjectType } from './utils/project-type'
import { selectService } from './utils/select'

const args = process.argv.slice(2)

const [command, type, name] = args

function showHelp(): void {
  console.log(`
🐺 VentJS CLI

Usage:
  vent g module <name>
  vent generate module <name>
  vent --help

Commands:
  --help         Show this help message
`)
}

async function main(): Promise<void> {
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    showHelp()
    return
  }

  if (args.includes('--version') || args.includes('-v')) {
    console.log('VentJS CLI')
    console.log('Version is provided by the installed package.')
    return
  }

  if ((command === 'g' || command === 'generate') && type === 'module' && name) {
    if ((await detectProjectType()) === 'graphql') {
      await generateGraphqlModule(name)
      return
    }

    const withService = await selectService()

    await restGenerateModule(name, withService)
    return
  }

  console.error('Unknown command.')
  showHelp()
  process.exitCode = 1
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Oops! Something went wrong'

  console.error(`VentJS CLI: ${message}`)
  process.exitCode = 1
})
