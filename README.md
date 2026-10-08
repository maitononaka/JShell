# JShell

JShell is a browser-based, terminal-oriented virtual OS written with HTML, CSS and JavaScript.

## Live

GitHub Pages (the repository path remains `/Termos/`):

https://maitononaka.github.io/Termos/

## Repository layout

```text
JShell/
├── index.html
├── style.css
├── app.js
├── README.md
└── packages/
    ├── index.json
    └── example/
        ├── manifest.json
        ├── index.html
        ├── style.css
        └── app.js
```

GitHub Pages can publish the repository as a static site while JShell provides the terminal-style OS experience in the browser.

## Commands

Type `help` to see a compact command list. Every command also supports `-h` and `--help`.

Examples:

```text
ls --help
cd --help
execute --help
pkg --help
```

## Execute un-packaged apps

`execute` runs custom apps without creating a package first.

HTML app:

```text
execute app/html "<!DOCTYPE JShellApp><body><h1>Hello JShell</h1></body>"
```

JavaScript app:

```text
execute app/javascript "document.body.innerHTML='<h1>Hello JShell</h1>'"
```

Options:

```text
-n   open in a new browser tab
-f   request fullscreen
-c   clear the JShell terminal before execution
```

Options can be combined:

```text
execute app/html "<!DOCTYPE JShellApp><body>...</body>" -n -f -c
```

`app/html` requires `<!DOCTYPE JShellApp>` at the beginning.

## Package manager

JShell includes a `pkg` command.

Example:

```text
pkg repo set https://maitononaka.github.io/Termos/packages/
pkg update
pkg search
pkg install example
pkg list
pkg run example
pkg remove example
```

The package repository index is:

```text
https://maitononaka.github.io/Termos/packages/index.json
```

## Creating a package

A package contains a `manifest.json` and its application files.

```text
packages/
└── myapp/
    ├── manifest.json
    ├── index.html
    ├── style.css
    └── app.js
```

Example `manifest.json`:

```json
{
  "name": "myapp",
  "version": "1.0.0",
  "description": "My JShell application",
  "entry": "index.html",
  "files": [
    "manifest.json",
    "index.html",
    "style.css",
    "app.js"
  ]
}
```

## Pause

`pause` now pauses execution until Enter is pressed.

```text
pause
pause Press Enter to continue...
```

## Important

JShell packages are browser applications. They run inside the JShell virtual environment and do not become native Linux/Windows programs.

Do not put passwords, API keys, private tokens, or other secrets into a package repository because GitHub Pages content is publicly accessible.

## License

See the repository for the current project license.
