import type { ReactNode } from "react";

export const metadata = {
  title: "Welcome",
};

/**
 * The front door. Joe's own note on what this is, what he chose, and what it does not
 * do yet. Rendered verbatim; the voice is the point.
 */

function A({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="underline underline-offset-2 hover:text-foreground"
    >
      {children}
    </a>
  );
}

/** One list entry: an optional bold lead-in term, then the body. */
function Item({ term, children }: { term?: string; children: ReactNode }) {
  return (
    <li className="text-sm leading-relaxed text-muted-foreground">
      {term ? <span className="font-medium text-foreground">{term}: </span> : null}
      {children}
    </li>
  );
}

function Section({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-medium text-foreground">{heading}</h2>
      <ul className="list-disc space-y-2.5 pl-5">{children}</ul>
    </section>
  );
}

export default function WelcomePage() {
  return (
    <div className="mx-auto max-w-3xl space-y-10">
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Welcome to Joe Vosburgh&rsquo;s voice eval webtool!
        </h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          My goal was to build an evaluation tool for Gradium&rsquo;s TTS model. This site
          allows for human rating, metric evaluation and light product marketing. I&rsquo;ve
          also included pages for viewing samples and understanding my methodology.
        </p>
      </div>

      <Section heading="In building this site, I made a few decisions">
        <Item term="Model Choice">
          I chose to evaluate TTS. This is because TTS has a handful of objective evaluation
          metrics (WER, latency), while largely remaining unsolved on subjective evaluation
          (stress, tone, cadence). This felt like a worthy challenge (also, it
          doesn&rsquo;t hurt that the job description called out TTS by name).
        </Item>
        <Item term="Queries">
          I used Claude Opus to generate queries in Gradium&rsquo;s five supported languages
          related to industry use cases (healthcare, banking, customer service, gaming).
          This felt more useful than{" "}
          <A href="https://artificialanalysis.ai/text-to-speech/arena">
            Artificial Analytics&rsquo;
          </A>{" "}
          novel/news-based approach, which tells an end-customer very little about
          performance related to their product.
        </Item>
        <Item term="Metrics">
          I calculated a handful of objective metrics (WER, Latency, UTMOS, DNSMOS) for
          speech samples. These appear nearly industry-standard. Only WER &amp; TTFA felt
          truly useful. F0 spread was somewhat informative, if under-contextualized.
        </Item>
        <Item term="Objective vs Rater-Derived">
          I focused a majority of my time on understanding how to solicit feedback through
          rating flows. While various researchers attempt to create embedding- or NN-based
          approaches (<A href="https://arxiv.org/abs/2010.15258">xMOS</A>,{" "}
          <A href="https://arxiv.org/pdf/2506.19441">TTSDS</A>,{" "}
          <A href="https://arxiv.org/abs/2005.07143">ECAPA-TDNN</A>, etc), I got the
          (na&iuml;ve) impression that these are not especially consistent (or useful)
          proxies.
        </Item>
        <Item term="Rating Flow">
          I iterated a few times on question type, order and format. This was largely
          motivated by dogfooding the rating flow and realizing that I was finding problems
          that I couldn&rsquo;t easily classify. It&rsquo;s not elegant, but hopefully
          generative.
        </Item>
        <Item term="WER Correction">
          In the rating flow, you&rsquo;ll see the last screen compares the audio against
          the ASR transcript. The purpose was to create labels with which to fine tune the
          ASR models.
        </Item>
      </Section>

      <Section heading="The product has (many) limitations">
        <Item term="Queries">
          These were all generated using an LLM: they&rsquo;re too clean, too short, too
          self-contained. This is too generous of a test set. Realistically, I&rsquo;d look
          for real transcripts or audio to test more difficult situations.
        </Item>
        <Item term="ASR Normalization">
          The first time I ran WER, I got ~40% error rate. Switching to{" "}
          <A href="https://huggingface.co/openai/whisper-large-v3">whisper large-v3</A>{" "}
          helped, but not much (I wanted to use a 3P transcription tool for this). I
          attempted to normalize the ASR outputs but I&rsquo;m not entirely sure about my
          logic.
        </Item>
        <Item term="Relative Evaluation">
          One of the practical values of an eval flow is gating model releases (and
          preventing quality regression). I couldn&rsquo;t access a prior model version via
          the API. Realistically, I&rsquo;d like to evaluate metrics A/B and create some sort
          of head-to-head (&agrave; la CMOS).
        </Item>
        <Item term="Rater Flow">
          The annotation flow is too long and cumbersome, I am aware! I was trying to show
          off a little.
        </Item>
      </Section>

      <Section heading="I made a few observations">
        <Item term="Stress &amp; Meter">
          The rating flow I built is pretty bad for solving this. 100k perfect reviews
          through my flow wouldn&rsquo;t teach the model much. I think a more advanced
          annotation tool (think: using{" "}
          <A href="https://www.britannica.com/topic/scansion">scansion</A>) would be
          required.
        </Item>
        <Item term="Voice">
          I chose a single voice for each language to reduce rater and UTMOS bias. After
          building the rating flow, I regretted this decision; I found the choice voices to
          be boring as a rater and mismatched to use cases.
        </Item>
        <Item term="WER is Worse Than I Thought">
          and I&rsquo;m not sure how to fix it. It seems like a powerful way to market a
          product to customers but the Type 1 error is concerning. Gradium&rsquo;s model was
          nearly-perfect (technically) and WER was ill-equipped to demonstrate that.
        </Item>
        <Item term="Subjective Rating">
          In my own listening, the &ldquo;objective&rdquo; metrics for prosody (UTMOS, etc)
          did little to warn me that a voice clip would completely butcher a currency or
          proper noun. A few high-quality annotations struck me as more valuable than 1000
          runs of <A href="https://github.com/sarulab-speech/UTMOS22">UTMOS</A>.
        </Item>
        <Item term="Rating Is Difficult">
          I was over-generous with my prosodic ratings early-on. It took 15-20 ratings before
          I started to become picky with timing, accent and stress. It&rsquo;s obvious now
          that the work requires a highly fluent and trained cohort.
        </Item>
        <Item term="Calculating Latency">
          My latency numbers were spookily low (~90ms). It took a while to debug; it turns
          out that I was timing the WAV header arriving, not the actual TTFA. The second
          run put me over my token budget (ugh) but the results look more credible.
        </Item>
      </Section>

      <Section heading="And want to share my closing thoughts">
        <Item>
          I believe that labeling is the best way to develop intuition. Given the limited
          time, my own labeling mostly just highlighted my own intuitive limitations. I
          clearly have much to learn in the field.
        </Item>
        <Item>
          I had a lot of fun doing this. Between Claude Code and Gradium&rsquo;s API, this
          was fairly easy to develop and launch, which gave me lots of opportunity to think
          and iterate.
        </Item>
        <Item>
          As always, building something requires and reveals so much more nuance than
          discussion can alone. I think I&rsquo;d do this differently the second time but
          I&rsquo;m pleased (enough) with the result.
        </Item>
      </Section>
    </div>
  );
}
