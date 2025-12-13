import Link from 'next/link';
import AnimatedText from '@/components/AnimatedText';
import { CopyButton } from '@/components/CopyButton';
import { DynamicCodeBlock } from 'fumadocs-ui/components/dynamic-codeblock';

const codeExample = `import { AnthropicModelProvider, createZypherAgent } from "@corespeed/zypher";
import { createFileSystemTools } from "@corespeed/zypher/tools";
import { eachValueFrom } from "rxjs-for-await";

const agent = await createZypherAgent({
  modelProvider: new AnthropicModelProvider({
    apiKey: Deno.env.get("ANTHROPIC_API_KEY")!,
  }),
  tools: [...createFileSystemTools()],
  mcpServers: ["@modelcontextprotocol/sequentialthinking-server"],
});

// Run task with streaming
const taskEvents = agent.runTask(
  "Implement authentication middleware",
  "claude-sonnet-4-20250514",
);

for await (const event of eachValueFrom(taskEvents)) {
  console.log(event);
}`;

export default function HomePage() {
  const tools = ['Cursor', 'Claude Code', 'Devin', 'DeckSpeed', 'Lovart'];

  return (
    <main className="flex flex-1 flex-col px-4 md:px-6 relative overflow-x-hidden bg-[radial-gradient(circle,_rgba(0,0,0,0.03)_1px,_transparent_1px)] dark:bg-[radial-gradient(circle,_rgba(255,255,255,0.03)_1px,_transparent_1px)] bg-[size:24px_24px]">
      {/* Hero Section */}
      <section className="w-full max-w-[1200px] mx-auto pt-12 md:pt-24 lg:pt-32 pb-16 md:pb-28">
        <div className="grid lg:grid-cols-[1fr_1.2fr] gap-8 lg:gap-12 items-center">
          {/* Left Column - Text Content */}
          <div className="flex flex-col">
            {/* Status Badge */}
            <Link
              href="https://jsr.io/@corespeed/zypher"
              target="_blank"
              rel="noopener noreferrer"
              className="mb-4 md:mb-8 w-fit"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="https://jsr.io/badges/@corespeed/zypher"
                alt="JSR"
              />
            </Link>

            <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-[3.5rem] font-semibold text-fd-foreground mb-4 md:mb-6 tracking-tight leading-[1.2]">
              Build your own
              <br />
              <AnimatedText
                texts={tools}
                className="text-fd-foreground"
                interval={2500}
              />
              <br />
              <span className="text-fd-muted-foreground">with</span>{' '}
              <span className="text-[#F2572B]">Zypher</span>
            </h1>



            <p className="text-base md:text-xl text-fd-muted-foreground mb-8 md:mb-10 leading-relaxed max-w-full md:max-w-lg text-balance">
              A few lines of code to create powerful AI agents. Connect any MCP server, choose your LLM provider, and start building.
            </p>

            {/* Install Command */}
            <div className="mb-8 flex items-center justify-between gap-2 sm:gap-3 px-3 sm:px-4 py-2.5 border border-fd-border w-full sm:w-fit text-xs sm:text-sm font-mono bg-fd-background">
              <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                <svg className="w-4 h-4 sm:w-5 sm:h-5 text-fd-foreground flex-shrink-0" viewBox="0 0 128 128" fill="currentColor">
                  <path d="M64 2C29.755 2 2 29.755 2 64c0 34.245 27.755 62 62 62 34.245 0 62-27.755 62-62 0-34.245-27.755-62-62-62zm32.09 20.126.023-.073.799-3.003.363.266a53.424 53.424 0 0 1 4.771 3.997l-.097.314-.022.073a3.03 3.03 0 0 1-3.488 2.01 3.02 3.02 0 0 1-2.349-3.584zm-13.853 5.716.023-.073c.46-1.55 2.107-2.47 3.705-2.059 1.574.436 2.519 2.059 2.131 3.657v.073l-3.245 11.988-.266-.218a32.286 32.286 0 0 0-5.11-3.1zM71.484 14.497l.023-.073 1.453-5.4.436.072c1.84.315 3.681.727 5.473 1.211l-1.526 5.691-.022.073a3.03 3.03 0 0 1-3.488 2.01 3.02 3.02 0 0 1-2.349-3.584zM49.009 23.7l.023-.073 3.826-14.216.412-.072a57.938 57.938 0 0 1 5.764-.824c.097.436.097.92-.023 1.356l-.022.073-4.117 15.258-.023.073a3.03 3.03 0 0 1-3.488 2.01 3.02 3.02 0 0 1-2.349-3.584zM13.843 56.395c-.46 1.55-2.107 2.47-3.681 2.058a2.867 2.867 0 0 1-1.502-.92 55.517 55.517 0 0 1 6.467-20.295c.242 0 .484.023.726.097a3.042 3.042 0 0 1 2.156 3.657l-.023.073-4.117 15.258zm12.4 8.33v.074l-4.117 15.258-.023.072c-.46 1.526-2.034 2.422-3.608 2.059-1.623-.388-2.616-2.034-2.229-3.657v-.073L20.384 63.2l.022-.073c.46-1.55 2.107-2.47 3.706-2.058 1.574.436 2.519 2.058 2.131 3.657zm1.187-20.78c-1.623-.387-2.616-2.034-2.228-3.656l.022-.073 4.117-15.258.023-.073c.46-1.55 2.107-2.47 3.681-2.058a3.028 3.028 0 0 1 2.156 3.633l-.023.096-4.117 15.258-.023.073c-.46 1.526-2.034 2.422-3.608 2.059zm7.992 52.096-.023.072c-.46 1.526-2.034 2.422-3.608 2.06-1.623-.388-2.616-2.035-2.228-3.658l.022-.073 4.117-15.258.023-.097.194-.46a27.216 27.216 0 0 0 5.231 3.56zm12.473 9.324-.023.073-2.93 10.923-.412-.17a51.943 51.943 0 0 1-5.207-2.252l2.712-10.075.023-.073a3.011 3.011 0 0 1 3.681-2.058c1.599.412 2.543 2.034 2.156 3.633zm16.929-7.726-.073.34v.072l-4.117 15.258-.023.073a3.03 3.03 0 0 1-3.487 2.01 3.032 3.032 0 0 1-2.35-3.584v-.073l4.118-15.258.022-.073a3.026 3.026 0 0 1 3.706-2.059 2.984 2.984 0 0 1 1.889 1.526l.097.436.145.702.097.51zm40.276 3.948c-8.622 9.421-20.441 15.863-33.737 17.631l-.121-.8-.218-1.598-.194-1.162-.218-1.526-.29-1.865-.121-.726-.266-1.768-.17-1.042-.218-1.356-.218-1.308-.218-1.26-.218-1.234-.194-1.211-.218-1.163-.194-1.114-.145-.823-.17-.8-.096-.508-.194-1.017-.146-.727-.169-.896-.145-.63-.12-.605-.122-.581-.073-.388-.17-.726-.12-.533-.121-.533-.097-.339-.12-.484-.098-.46-.12-.46-.121-.437-.073-.266-.121-.412-.097-.387-.073-.266-.097-.243-.072-.218-.097-.339-.073-.242-.049-.145a9.113 9.113 0 0 0-.435-1.138l-.073-.145.557-1.454-2.204.073-.605.023c-20.006.412-32.915-8.09-32.915-21.409 0-14.12 14.047-25.478 32.066-25.478 8.67 0 16.105 2.398 21.966 6.975 4.989 3.9 8.646 9.276 10.535 15.355l.048.145.048.17.097.314.145.582.388 1.356.411 1.55.703 2.567 1.114 4.069 1.792 6.684 2.035 7.605 3.269 12.23 1.235 4.601zm3.052-60.595-.023.073-4.117 15.258-.023.073c-.46 1.525-2.034 2.421-3.609 2.058-1.622-.387-2.615-2.034-2.228-3.657l.023-.073 4.117-15.258v-.072a3.078 3.078 0 0 1 3.705-2.059 3.062 3.062 0 0 1 2.156 3.657zm10.414 20.344-4.142 15.258v.073c-.436 1.623-2.107 2.567-3.73 2.131-1.622-.436-2.567-2.107-2.13-3.73l.022-.072 4.117-15.258.023-.073c.46-1.55 2.107-2.47 3.681-2.059a3.028 3.028 0 0 1 2.156 3.633zM69.329 51.164a3.875 3.875 0 0 1-3.875 3.875 3.875 3.875 0 0 1-3.875-3.875 3.875 3.875 0 0 1 3.875-3.875 3.875 3.875 0 0 1 3.875 3.875z"/>
                </svg>
                <span className="text-fd-muted-foreground truncate">deno add jsr:@corespeed/zypher</span>
              </div>
              <CopyButton text="deno add jsr:@corespeed/zypher" className="flex-shrink-0" />
            </div>

            <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
              <Link
                href="/docs/quick-start"
                className="group px-5 py-2.5 border border-fd-foreground text-fd-foreground font-medium hover:bg-fd-foreground hover:text-fd-background transition-all text-center inline-flex items-center justify-center gap-2 text-sm w-full sm:w-auto sm:min-w-[140px]"
              >
                Read Docs
                <svg className="w-4 h-4 transition-transform group-hover:translate-x-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                </svg>
              </Link>
              <Link
                href="https://github.com/corespeed-io/zypher-agent"
                target="_blank"
                rel="noopener noreferrer"
                className="group px-5 py-2.5 border border-fd-border text-fd-foreground font-medium text-center text-sm hover:bg-fd-foreground hover:text-fd-background transition-all inline-flex items-center justify-center gap-2 w-full sm:w-auto sm:min-w-[140px]"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                </svg>
                GitHub
              </Link>
            </div>
          </div>

          {/* Right Column - Code Block */}
          <div className="w-full overflow-hidden">
            <div className="relative [&_figure]:!my-0 [&_figure]:!rounded-none [&_figure]:!border-fd-border [&_pre]:!max-h-[300px] md:[&_pre]:!max-h-[400px]">
              <DynamicCodeBlock
                lang="typescript"
                code={codeExample}
                codeblock={{
                  title: 'main.ts',
                }}
              />
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="w-full">
        <div className="max-w-[1100px] mx-auto py-12 md:py-28 px-4 md:px-0">
          <h2 className="text-2xl md:text-3xl font-semibold text-fd-foreground mb-3 md:mb-4 text-center">
            Everything you need to build AI agents
          </h2>
          <p className="text-fd-muted-foreground text-center mb-10 md:mb-16 max-w-2xl mx-auto text-balance text-sm md:text-base">
            A minimal yet powerful framework for creating AI agents with full control over tools, providers, and execution flow.
          </p>

          <div className="grid md:grid-cols-2 gap-4 md:gap-6">
            {/* Feature 1 - True Agent */}
            <div className="group p-4 md:p-6 border border-fd-border hover:border-fd-foreground/50 transition-all duration-200">
              <h3 className="text-base font-semibold mb-2 text-fd-foreground">True Agent, Not Workflow</h3>
              <p className="text-fd-muted-foreground text-sm leading-relaxed">
                A reactive execution loop where the agent decides each next step via LLM reasoning — no predefined workflow paths required.
              </p>
            </div>

            {/* Feature 2 - Interceptor Pipeline */}
            <div className="group p-4 md:p-6 border border-fd-border hover:border-fd-foreground/50 transition-all duration-200">
              <h3 className="text-base font-semibold mb-2 text-fd-foreground">Extensible Interceptor Pipeline</h3>
              <p className="text-fd-muted-foreground text-sm leading-relaxed">
                A post-reasoning pipeline with built-in tool execution, error handling, and token controls, plus support for custom interceptors.
              </p>
            </div>

            {/* Feature 3 - Rich Tools + MCP */}
            <div className="group p-4 md:p-6 border border-fd-border hover:border-fd-foreground/50 transition-all duration-200">
              <h3 className="text-base font-semibold mb-2 text-fd-foreground">Rich Tools + MCP Protocol</h3>
              <p className="text-fd-muted-foreground text-sm leading-relaxed">
                A comprehensive tool system for file ops, execution, vision, and documents, with MCP protocol support for unlimited extensibility.
              </p>
            </div>

            {/* Feature 4 - Model Agnostic */}
            <div className="group p-4 md:p-6 border border-fd-border hover:border-fd-foreground/50 transition-all duration-200">
              <h3 className="text-base font-semibold mb-2 text-fd-foreground">Model & Provider Agnostic</h3>
              <p className="text-fd-muted-foreground text-sm leading-relaxed">
                Works with Anthropic Claude, OpenAI GPT, and more models through a unified interface — with native support for each provider's unique features.
              </p>
            </div>

            {/* Feature 5 - Multi-Agent */}
            <div className="group p-4 md:p-6 border border-fd-border hover:border-fd-foreground/50 transition-all duration-200">
              <h3 className="text-base font-semibold mb-2 text-fd-foreground">Multi-Agent Architecture</h3>
              <p className="text-fd-muted-foreground text-sm leading-relaxed">
                Break complex tasks into subtasks handled by specialized sub-agents — with automatic context sharing and coordinated handoffs.
              </p>
            </div>

            {/* Feature 6 - Token Efficient */}
            <div className="group p-4 md:p-6 border border-fd-border hover:border-fd-foreground/50 transition-all duration-200">
              <h3 className="text-base font-semibold mb-2 text-fd-foreground">Token-Efficient by Design</h3>
              <p className="text-fd-muted-foreground text-sm leading-relaxed">
                Load only what's needed into context. On-demand skill loading, programmatic tool use that keeps intermediate results out of context, and prompt caching — minimal tokens, maximum efficiency.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="w-full">
        <div className="max-w-[1100px] mx-auto py-12 md:py-20 text-center px-4 md:px-0">
          <p className="text-sm text-fd-muted-foreground mb-6">
            Ready to build your first agent?
          </p>
          <Link
            href="/docs/quick-start"
            className="inline-flex items-center gap-2 text-fd-foreground font-medium hover:text-[#F2572B] transition-colors border-b border-fd-foreground/50 pb-0.5"
          >
            Read the documentation
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
            </svg>
          </Link>
        </div>
      </section>
    </main>
  );
}
