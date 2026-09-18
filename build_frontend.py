import pathlib
import subprocess

FRONTEND = pathlib.Path(__file__).resolve().parent / "frontend"


def main() -> None:
    subprocess.run(["npm", "ci"], cwd=FRONTEND, check=True)
    subprocess.run(["npm", "run", "build"], cwd=FRONTEND, check=True)


if __name__ == "__main__":
    main()
