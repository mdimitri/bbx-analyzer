"""Shared fixtures. Tests run on tests/data/short.bbl (the first 1.5 MB of a real 7″ flight, so it also ends in a
truncated frame) and, when present, on every full log in logs/ (skipped otherwise)."""
import shutil
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
DATA = ROOT / "tests" / "data"


def full_logs():
    return sorted(p for p in (ROOT / "logs").glob("*.[Bb][Bb][Ll]") if not p.name.startswith("TEST_"))


@pytest.fixture
def short_log(tmp_path):
    """A private copy, so decode caches never touch the repo."""
    p = tmp_path / "short.bbl"
    shutil.copy(DATA / "short.bbl", p)
    return p


@pytest.fixture(scope="session")
def short_lg(tmp_path_factory):
    from bbl import Log
    d = tmp_path_factory.mktemp("lg")
    p = d / "short.bbl"
    shutil.copy(DATA / "short.bbl", p)
    return Log(p, 1)
